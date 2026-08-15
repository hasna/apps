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
    if (sql.includes("FROM hooks WHERE enabled = 1")) {
      return [...this.hooks.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }
    return [];
  }

  private exec(sql: string, params: unknown[]): void {
    if (sql.includes("INSERT INTO hook_versions")) {
      this.versions.set(`${params[0]}@${params[1]}`, {
        name: params[0],
        version: params[1],
        manifest_json: params[2],
        script_sha256: params[3],
        artifact_key: params[4],
        published_at: params[5],
      });
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

  async get(key: string) {
    const raw = this.objects.get(key);
    if (!raw) return null;
    return { json: async () => JSON.parse(raw) };
  }

  async put(key: string, value: string) {
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
});
