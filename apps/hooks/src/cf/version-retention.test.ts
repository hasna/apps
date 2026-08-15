/**
 * Regression tests for P1-4 version retention (bug d3b4025c).
 *
 * PUT must never overwrite an existing (name, version): a byte-identical
 * republish is idempotent, a conflicting one is a 409. Older published
 * versions must be fetchable by exact pin, and the catalog + lock must
 * expose versions[] while the hooks table stays the latest pointer.
 *
 * Uses a stateful in-memory D1/R2 fake so publish history persists across
 * requests in each test.
 */

import { describe, expect, test } from "bun:test";
import worker, { type Env } from "./worker.js";
import { SEMVER_PATTERN } from "../lib/semver.js";

const SCRIPT_V1 = "console.log('v1');\n";
const SCRIPT_V2 = "console.log('v2');\n";

function sha256Hex(text: string): string {
  return Bun.CryptoHasher.hash("sha256", text, "hex");
}

class FakeD1 {
  hooks = new Map<string, Record<string, unknown>>();
  versions = new Map<string, Record<string, unknown>>();
  /**
   * When true, a hook_versions INSERT yields for 5ms first, so a sibling PUT
   * racing the same new (name, version) deterministically passes its
   * existence check before either insert lands (P2-4 concurrent test).
   */
  yieldInsert = false;

  prepare(sql: string) {
    const self = this;
    let params: unknown[] = [];
    return {
      bind(...values: unknown[]) {
        params = values;
        return this;
      },
      async first() {
        return self.queryFirst(sql, params);
      },
      async all() {
        return { results: self.queryAll(sql, params), success: true };
      },
      async run() {
        if (self.yieldInsert && sql.includes("INSERT INTO hook_versions")) {
          await Bun.sleep(5);
        }
        self.exec(sql, params);
        return {};
      },
    };
  }

  private queryFirst(sql: string, params: unknown[]): unknown {
    if (sql.includes("FROM hook_versions WHERE")) {
      const name = params[0];
      const version = params[1];
      return [...this.versions.values()].find((r) => r.name === name && r.version === version) ?? null;
    }
    if (sql.includes("SELECT version FROM hooks")) {
      // 6e412e52: the latest-pointer downgrade guard reads the current
      // pointer before deciding whether to move it.
      const row = this.hooks.get(String(params[0]));
      return row ? { version: String(row.version) } : null;
    }
    if (sql.includes("FROM hooks WHERE name = ? AND version = ?")) {
      const version = params[1];
      return [...this.hooks.values()].find((r) => r.version === version) ?? null;
    }
    return null;
  }

  private queryAll(sql: string, params: unknown[]): unknown[] {
    if (sql.includes("FROM hook_versions WHERE name = ?")) {
      const name = params[0];
      return [...this.versions.values()]
        .filter((r) => r.name === name)
        .sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)));
    }
    if (sql.includes("SELECT name, version, script_sha256, published_at FROM hook_versions")) {
      // 6e412e52 heal query: ALL published versions; the worker picks the
      // highest SEMVER per name in JS (published_at is no longer a proxy for
      // newest — an older-version republish carries a LATER timestamp).
      return [...this.versions.values()].map((r) => ({
        name: r.name,
        version: r.version,
        script_sha256: r.script_sha256,
        published_at: r.published_at,
      }));
    }
    if (sql.includes("FROM hooks WHERE enabled = 1")) {
      return [...this.hooks.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }
    return [];
  }

  private exec(sql: string, params: unknown[]): void {
    if (sql.includes("INSERT INTO hook_versions")) {
      const key = `${params[0]}@${params[1]}`;
      // P2-4: a concurrent second INSERT of the same (name, version) hits the
      // primary key exactly like D1 — the loser must fail, not overwrite.
      if (this.versions.has(key)) throw new Error(`constraint failed: PRIMARY KEY (name, version)`);
      this.versions.set(key, {
        name: params[0],
        version: params[1],
        manifest_json: params[2],
        script_sha256: params[3],
        artifact_key: params[4],
        published_at: params[5],
      });
      return;
    }
    if (sql.includes("DELETE FROM hook_versions")) {
      this.versions.delete(`${params[0]}@${params[1]}`);
      return;
    }
    if (sql.includes("INSERT INTO hooks")) {
      this.hooks.set(String(params[0]), {
        id: params[0],
        name: params[1],
        version: params[2],
        sha256: params[3],
        source_type: params[4],
        installed_at: params[6],
        enabled: 1,
      });
    }
  }
}

class FakeR2 {
  objects = new Map<string, string>();
  failPuts = false;

  async get(key: string) {
    const raw = this.objects.get(key);
    if (!raw) return null;
    return { json: async () => JSON.parse(raw) };
  }

  async put(key: string, value: string) {
    if (this.failPuts) throw new Error("r2 unavailable (injected)");
    this.objects.set(key, value);
  }
}

function makeEnv(): Env {
  return {
    HOOKS_D1: new FakeD1() as never,
    HOOKS_R2: new FakeR2() as never,
    HOOKS_API_KEY: "secret-key",
  };
}

function publishBody(version: string, script: string): Request {
  return new Request("https://hooks-registry.test/api/v1/hooks", {
    method: "PUT",
    headers: { "x-api-key": "secret-key", "content-type": "application/json" },
    body: JSON.stringify({
      manifest: { name: "gitguard", version, events: ["PreToolUse"], script: "src/hook.ts" },
      script,
    }),
  });
}

function req(method: string, path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://hooks-registry.test${path}`, { method, headers });
}

describe("worker version retention (P1-4 / d3b4025c)", () => {
  test("publishing v1 then v2 keeps both; latest pointer moves; catalog exposes versions", async () => {
    const env = makeEnv();
    const p1 = await worker.fetch(publishBody("1.0.0", SCRIPT_V1), env);
    expect(p1.status).toBe(200);
    const p2 = await worker.fetch(publishBody("1.1.0", SCRIPT_V2), env);
    expect(p2.status).toBe(200);

    const catalog = await (await worker.fetch(req("GET", "/api/v1/catalog", { "x-api-key": "secret-key" }), env)).json() as { hooks: Array<{ name: string; version: string; versions: string[] }> };
    expect(catalog.hooks).toHaveLength(1);
    expect(catalog.hooks[0].version).toBe("1.1.0");
    expect(catalog.hooks[0].versions).toEqual(["1.0.0", "1.1.0"]);

    const lock = await (await worker.fetch(req("GET", "/api/v1/lock", { "x-api-key": "secret-key" }), env)).json() as { hooks: Record<string, { version: string; versions: string[] }> };
    expect(lock.hooks.gitguard.version).toBe("1.1.0");
    expect(lock.hooks.gitguard.versions).toEqual(["1.0.0", "1.1.0"]);
  });

  test("the exact older version is fetchable by pin with its own sha", async () => {
    const env = makeEnv();
    await worker.fetch(publishBody("1.0.0", SCRIPT_V1), env);
    await worker.fetch(publishBody("1.1.0", SCRIPT_V2), env);

    const old = await worker.fetch(req("GET", "/api/v1/hooks/gitguard/1.0.0", { "x-api-key": "secret-key" }), env);
    expect(old.status).toBe(200);
    expect(old.headers.get("x-hook-sha256")).toBe(sha256Hex(SCRIPT_V1));
    const oldBody = await old.json() as { script: string };
    expect(oldBody.script).toBe(SCRIPT_V1);

    const latest = await worker.fetch(req("GET", "/api/v1/hooks/gitguard/1.1.0", { "x-api-key": "secret-key" }), env);
    expect(latest.status).toBe(200);
    expect(latest.headers.get("x-hook-sha256")).toBe(sha256Hex(SCRIPT_V2));

    const missing = await worker.fetch(req("GET", "/api/v1/hooks/gitguard/9.9.9", { "x-api-key": "secret-key" }), env);
    expect(missing.status).toBe(404);
  });

  test("a byte-identical republish of the same version is idempotent", async () => {
    const env = makeEnv();
    expect((await worker.fetch(publishBody("1.0.0", SCRIPT_V1), env)).status).toBe(200);
    const second = await worker.fetch(publishBody("1.0.0", SCRIPT_V1), env);
    expect(second.status).toBe(200);
    const body = await second.json() as { idempotent?: boolean };
    expect(body.idempotent).toBe(true);
  });

  test("a conflicting republish of the same version is refused with 409 and never overwrites", async () => {
    const env = makeEnv();
    expect((await worker.fetch(publishBody("1.0.0", SCRIPT_V1), env)).status).toBe(200);
    const conflict = await worker.fetch(publishBody("1.0.0", SCRIPT_V2), env);
    expect(conflict.status).toBe(409);
    const body = await conflict.json() as { error: string };
    expect(body.error).toMatch(/immutable/);

    // The stored artifact is still v1 bytes.
    const old = await worker.fetch(req("GET", "/api/v1/hooks/gitguard/1.0.0", { "x-api-key": "secret-key" }), env);
    const oldBody = await old.json() as { script: string };
    expect(oldBody.script).toBe(SCRIPT_V1);
  });

  test("prerelease and build-metadata versions publish and fetch (route encoding round-trip)", async () => {
    const env = makeEnv();
    const pre = "1.2.3-beta.1";
    const build = "2.0.0+meta.5";
    expect((await worker.fetch(publishBody(pre, SCRIPT_V1), env)).status).toBe(200);
    expect((await worker.fetch(publishBody(build, SCRIPT_V2), env)).status).toBe(200);

    const encodedPre = encodeURIComponent(pre);
    const encodedBuild = encodeURIComponent(build);
    const preRes = await worker.fetch(req("GET", `/api/v1/hooks/gitguard/${encodedPre}`, { "x-api-key": "secret-key" }), env);
    expect(preRes.status).toBe(200);
    const buildRes = await worker.fetch(req("GET", `/api/v1/hooks/gitguard/${encodedBuild}`, { "x-api-key": "secret-key" }), env);
    expect(buildRes.status).toBe(200);
    expect((await buildRes.json() as { manifest: { version: string } }).manifest.version).toBe(build);
  });

  test("an invalid version is rejected at publish with 400", async () => {
    const env = makeEnv();
    const res = await worker.fetch(publishBody("not-a-version", SCRIPT_V1), env);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/semver/);
  });

  test("SEMVER_PATTERN is shared with the manifest validation (P2-10)", () => {
    expect(SEMVER_PATTERN.test("1.2.3")).toBe(true);
    expect(SEMVER_PATTERN.test("1.2.3-beta.1")).toBe(true);
  });

  test("concurrent first-publish of the same new version: one succeeds, the loser 409s, no artifact mismatch (P2-4)", async () => {
    const env = makeEnv();
    const d1 = env.HOOKS_D1 as unknown as FakeD1;
    // Force the race: both PUTs pass the existence check before either
    // version row lands (the insert yields, the sibling catches up).
    d1.yieldInsert = true;
    const [r1, r2] = await Promise.all([
      worker.fetch(publishBody("3.0.0", SCRIPT_V1), env),
      worker.fetch(publishBody("3.0.0", SCRIPT_V2), env),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    // The recorded script_sha256 matches the R2 bytes that actually landed.
    const versionRow = d1.versions.get("gitguard@3.0.0")!;
    const recordedSha = String(versionRow.script_sha256);
    const artifact = await (env.HOOKS_R2 as unknown as FakeR2).get("hook_artifacts/gitguard/3.0.0.json");
    expect(artifact).not.toBeNull();
    const payload = await artifact!.json() as { script: string };
    expect(recordedSha).toBe(sha256Hex(payload.script));
    // The catalog serves the artifact consistent with the version row.
    const catalog = await (await worker.fetch(req("GET", "/api/v1/catalog", { "x-api-key": "secret-key" }), env)).json() as { hooks: Array<{ version: string; sha256: string }> };
    expect(catalog.hooks).toHaveLength(1);
    expect(catalog.hooks[0].sha256).toBe(recordedSha);
  });

  test("an R2 write failure rolls back the version row — no partial state survives (P2-4)", async () => {
    const env = makeEnv();
    const d1 = env.HOOKS_D1 as unknown as FakeD1;
    const r2 = env.HOOKS_R2 as unknown as FakeR2;
    r2.failPuts = true;
    const res = await worker.fetch(publishBody("6.0.0", SCRIPT_V1), env);
    expect(res.status).toBe(500);
    expect(d1.versions.size).toBe(0);
    expect(d1.hooks.size).toBe(0);
    // The version is publishable again — no lingering row blocks it.
    r2.failPuts = false;
    expect((await worker.fetch(publishBody("6.0.0", SCRIPT_V1), env)).status).toBe(200);
    expect(d1.versions.has("gitguard@6.0.0")).toBe(true);
  });

  test("a crash between the version INSERT and the latest-pointer upsert heals on the next catalog GET (P2-4)", async () => {
    const env = makeEnv();
    const d1 = env.HOOKS_D1 as unknown as FakeD1;
    const sha = sha256Hex(SCRIPT_V1);
    d1.versions.set("gitguard@5.0.0", {
      name: "gitguard",
      version: "5.0.0",
      manifest_json: JSON.stringify({ name: "gitguard", version: "5.0.0", events: ["PreToolUse"], script: "src/hook.ts" }),
      script_sha256: sha,
      artifact_key: "hook_artifacts/gitguard/5.0.0.json",
      published_at: "2026-08-15T00:00:00.000Z",
    });
    (env.HOOKS_R2 as unknown as FakeR2).objects.set(
      "hook_artifacts/gitguard/5.0.0.json",
      JSON.stringify({ manifest: { name: "gitguard", version: "5.0.0", events: ["PreToolUse"], script: "src/hook.ts" }, script: SCRIPT_V1 }),
    );
    // No hooks row: the crash window between INSERT and pointer upsert.
    expect(d1.hooks.has("gitguard")).toBe(false);

    const catalog = await (await worker.fetch(req("GET", "/api/v1/catalog", { "x-api-key": "secret-key" }), env)).json() as { hooks: Array<{ name: string; version: string; sha256: string; versions: string[] }> };
    expect(catalog.hooks).toHaveLength(1);
    expect(catalog.hooks[0].name).toBe("gitguard");
    expect(catalog.hooks[0].version).toBe("5.0.0");
    expect(catalog.hooks[0].sha256).toBe(sha);
    expect(catalog.hooks[0].versions).toEqual(["5.0.0"]);
    // The pointer row was healed, so the lock agrees on the next read.
    expect(d1.hooks.get("gitguard")?.version).toBe("5.0.0");
    const lock = await (await worker.fetch(req("GET", "/api/v1/lock", { "x-api-key": "secret-key" }), env)).json() as { hooks: Record<string, { version: string }> };
    expect(lock.hooks.gitguard.version).toBe("5.0.0");
  });

  test("a byte-identical republish heals a missing latest pointer (P2-4)", async () => {
    const env = makeEnv();
    const d1 = env.HOOKS_D1 as unknown as FakeD1;
    expect((await worker.fetch(publishBody("1.0.0", SCRIPT_V1), env)).status).toBe(200);
    // Simulate the crash window: the version row exists, the pointer is gone.
    d1.hooks.delete("gitguard");
    const second = await worker.fetch(publishBody("1.0.0", SCRIPT_V1), env);
    expect(second.status).toBe(200);
    const body = await second.json() as { idempotent?: boolean };
    expect(body.idempotent).toBe(true);
    expect(d1.hooks.has("gitguard")).toBe(true);
    expect(d1.hooks.get("gitguard")?.version).toBe("1.0.0");
  });

  test("publishing an OLDER version never moves the latest pointer down (6e412e52)", async () => {
    const env = makeEnv();
    expect((await worker.fetch(publishBody("1.0.2", SCRIPT_V2), env)).status).toBe(200);
    expect((await worker.fetch(publishBody("1.0.1", SCRIPT_V1), env)).status).toBe(200);

    const catalog = await (await worker.fetch(req("GET", "/api/v1/catalog", { "x-api-key": "secret-key" }), env)).json() as { hooks: Array<{ name: string; version: string; versions: string[] }> };
    expect(catalog.hooks).toHaveLength(1);
    expect(catalog.hooks[0].name).toBe("gitguard");
    expect(catalog.hooks[0].version, "pointer must stay on the higher version").toBe("1.0.2");
    expect(catalog.hooks[0].versions).toEqual(["1.0.2", "1.0.1"]);

    // The older row IS stored and fetchable by exact pin — history grows.
    const old = await worker.fetch(req("GET", "/api/v1/hooks/gitguard/1.0.1", { "x-api-key": "secret-key" }), env);
    expect(old.status).toBe(200);
    expect(old.headers.get("x-hook-sha256")).toBe(sha256Hex(SCRIPT_V1));

    const lock = await (await worker.fetch(req("GET", "/api/v1/lock", { "x-api-key": "secret-key" }), env)).json() as { hooks: Record<string, { version: string; versions: string[] }> };
    expect(lock.hooks.gitguard.version).toBe("1.0.2");
    expect(lock.hooks.gitguard.versions).toEqual(["1.0.2", "1.0.1"]);
  });

  test("publishing a HIGHER version still moves the pointer forward (6e412e52)", async () => {
    const env = makeEnv();
    expect((await worker.fetch(publishBody("1.0.2", SCRIPT_V2), env)).status).toBe(200);
    expect((await worker.fetch(publishBody("1.0.3", SCRIPT_V2), env)).status).toBe(200);

    const catalog = await (await worker.fetch(req("GET", "/api/v1/catalog", { "x-api-key": "secret-key" }), env)).json() as { hooks: Array<{ version: string; versions: string[] }> };
    expect(catalog.hooks[0].version).toBe("1.0.3");
    expect(catalog.hooks[0].versions).toEqual(["1.0.2", "1.0.3"]);
  });

  test("a prerelease never displaces its own release as the pointer (6e412e52)", async () => {
    const env = makeEnv();
    expect((await worker.fetch(publishBody("1.0.0", SCRIPT_V1), env)).status).toBe(200);
    expect((await worker.fetch(publishBody("1.0.0-beta.1", SCRIPT_V1), env)).status).toBe(200);

    const catalog = await (await worker.fetch(req("GET", "/api/v1/catalog", { "x-api-key": "secret-key" }), env)).json() as { hooks: Array<{ version: string; versions: string[] }> };
    expect(catalog.hooks[0].version).toBe("1.0.0");
    expect(catalog.hooks[0].versions).toEqual(["1.0.0", "1.0.0-beta.1"]);
  });

  test("a same-version identical republish leaves the pointer unchanged (6e412e52)", async () => {
    const env = makeEnv();
    expect((await worker.fetch(publishBody("1.0.2", SCRIPT_V2), env)).status).toBe(200);
    expect((await worker.fetch(publishBody("1.0.1", SCRIPT_V1), env)).status).toBe(200);
    const d1 = env.HOOKS_D1 as unknown as FakeD1;
    expect(d1.hooks.get("gitguard")?.version).toBe("1.0.2");

    const again = await worker.fetch(publishBody("1.0.2", SCRIPT_V2), env);
    expect(again.status).toBe(200);
    expect((await again.json() as { idempotent?: boolean }).idempotent).toBe(true);
    expect(d1.hooks.get("gitguard")?.version, "pointer must not move on an idempotent republish").toBe("1.0.2");
  });

  test("the heal path picks the highest SEMVER, never a later-published older version (6e412e52)", async () => {
    const env = makeEnv();
    const d1 = env.HOOKS_D1 as unknown as FakeD1;
    const sha1 = sha256Hex(SCRIPT_V1);
    const sha2 = sha256Hex(SCRIPT_V2);
    // 1.0.2 published FIRST; the older 1.0.1 republished LATER. The crash
    // window (no pointer row) must heal to 1.0.2 by semver, not to 1.0.1 by
    // published_at — exactly the downgrade the old heal query performed.
    d1.versions.set("gitguard@1.0.2", {
      name: "gitguard",
      version: "1.0.2",
      manifest_json: JSON.stringify({ name: "gitguard", version: "1.0.2", events: ["PreToolUse"], script: "src/hook.ts" }),
      script_sha256: sha2,
      artifact_key: "hook_artifacts/gitguard/1.0.2.json",
      published_at: "2026-08-15T00:00:00.000Z",
    });
    d1.versions.set("gitguard@1.0.1", {
      name: "gitguard",
      version: "1.0.1",
      manifest_json: JSON.stringify({ name: "gitguard", version: "1.0.1", events: ["PreToolUse"], script: "src/hook.ts" }),
      script_sha256: sha1,
      artifact_key: "hook_artifacts/gitguard/1.0.1.json",
      published_at: "2026-08-15T01:00:00.000Z",
    });
    (env.HOOKS_R2 as unknown as FakeR2).objects.set(
      "hook_artifacts/gitguard/1.0.2.json",
      JSON.stringify({ manifest: { name: "gitguard", version: "1.0.2", events: ["PreToolUse"], script: "src/hook.ts" }, script: SCRIPT_V2 }),
    );
    (env.HOOKS_R2 as unknown as FakeR2).objects.set(
      "hook_artifacts/gitguard/1.0.1.json",
      JSON.stringify({ manifest: { name: "gitguard", version: "1.0.1", events: ["PreToolUse"], script: "src/hook.ts" }, script: SCRIPT_V1 }),
    );
    expect(d1.hooks.has("gitguard")).toBe(false);

    const catalog = await (await worker.fetch(req("GET", "/api/v1/catalog", { "x-api-key": "secret-key" }), env)).json() as { hooks: Array<{ version: string; sha256: string; versions: string[] }> };
    expect(catalog.hooks).toHaveLength(1);
    expect(catalog.hooks[0].version, "healed pointer must be the highest semver, not the latest published_at").toBe("1.0.2");
    expect(catalog.hooks[0].sha256).toBe(sha2);
    expect(catalog.hooks[0].versions).toEqual(["1.0.2", "1.0.1"]);
    expect(d1.hooks.get("gitguard")?.version).toBe("1.0.2");

    const lock = await (await worker.fetch(req("GET", "/api/v1/lock", { "x-api-key": "secret-key" }), env)).json() as { hooks: Record<string, { version: string }> };
    expect(lock.hooks.gitguard.version).toBe("1.0.2");
  });
});
