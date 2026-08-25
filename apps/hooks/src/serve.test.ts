import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { handleServeRequest, startServeServer, resolveServeOptions, DEFAULT_SERVE_PORT, SERVE_HOST } from "./serve.js";
import { writeCustomHook, customHookDir } from "./lib/manifest.js";
import { readLock, sha256Of } from "./lib/store.js";
import { getHook } from "./lib/registry.js";
import { closeDb } from "./db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-serve-test-"));

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:${DEFAULT_SERVE_PORT}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("serve health", () => {
  test("GET /health returns ok", async () => {
    const res = await handleServeRequest(req("GET", "/health"), "secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "hooks-registry" });
  });

  test("unknown routes are 404", async () => {
    const res = await handleServeRequest(req("GET", "/nope"), "secret");
    expect(res.status).toBe(404);
  });
});

describe("serve catalog and artifacts", () => {
  test("GET /api/v1/catalog lists bundled hooks with versions and sha256", async () => {
    const res = await handleServeRequest(req("GET", "/api/v1/catalog"), undefined);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hooks: Array<{ name: string; version: string; sha256: string; events: string[] }> };
    expect(body.hooks.length).toBeGreaterThanOrEqual(40);
    const gitguard = body.hooks.find((h) => h.name === "gitguard");
    expect(gitguard).toBeTruthy();
    expect(gitguard!.version).toBe(getHook("gitguard")!.version);
    expect(gitguard!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(gitguard!.events).toContain("PreToolUse");
  });

  test("GET /api/v1/hooks/:name/:version returns manifest + script with sha header", async () => {
    const meta = getHook("gitguard")!;
    const res = await handleServeRequest(req("GET", `/api/v1/hooks/gitguard/${meta.version}`), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-hook-sha256") ?? "").toMatch(/^[0-9a-f]{64}$/);
    const body = (await res.json()) as { manifest: { name: string; version: string }; script: string };
    expect(body.manifest.name).toBe("gitguard");
    expect(body.manifest.version).toBe(meta.version);
    expect(body.script.length).toBeGreaterThan(0);
    expect(sha256Of(body.script)).toBe(res.headers.get("x-hook-sha256") ?? "");
  });

  test("unknown version is 404", async () => {
    const res = await handleServeRequest(req("GET", "/api/v1/hooks/gitguard/99.0.0"), undefined);
    expect(res.status).toBe(404);
  });

  test("catalog includes custom hooks overriding bundled names", async () => {
    const dir = customHookDir("gitguard");
    writeCustomHook("gitguard", {
      name: "gitguard",
      version: "9.9.9",
      description: "custom override",
      events: ["PreToolUse"],
      script: "custom.ts",
    }, "export const override = 1;", "custom.ts");
    try {
      const res = await handleServeRequest(req("GET", "/api/v1/catalog"), undefined);
      const body = (await res.json()) as { hooks: Array<{ name: string; source: string; version: string }> };
      const entries = body.hooks.filter((h) => h.name === "gitguard");
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry?.source).toBe("custom-overrides-bundled");
      expect(entry?.version).toBe("9.9.9");
      const artifact = await handleServeRequest(req("GET", "/api/v1/hooks/gitguard/9.9.9"), undefined);
      expect(artifact.status).toBe(200);
      const payload = (await artifact.json()) as { manifest: { version: string } };
      expect(payload.manifest.version).toBe("9.9.9");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("serve bind resolution (O15-00733)", () => {
  // Regression: the ECS task-def declares PORT=8080 and the LB health check
  // hits 8080, but startServeServer ignored the env and bound the local
  // registry default 39428 — the container came up unhealthy and the hooks
  // deploy was blocked. The serve surface MUST honor the container-standard
  // PORT/HOST env vars (argv flags still win).
  function withEnv(name: string, value: string | undefined, fn: () => void) {
    const prev = process.env[name];
    try {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
      fn();
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  }

  test("PORT env overrides the local registry default", () => {
    withEnv("PORT", "8080", () => {
      expect(resolveServeOptions({})).toEqual({ port: 8080, host: SERVE_HOST });
    });
  });

  test("HOST env overrides the loopback default", () => {
    withEnv("HOST", "0.0.0.0", () => {
      expect(resolveServeOptions({})).toEqual({ port: DEFAULT_SERVE_PORT, host: "0.0.0.0" });
    });
  });

  test("explicit port/host options still win over env", () => {
    withEnv("PORT", "8080", () => {
      withEnv("HOST", "0.0.0.0", () => {
        expect(resolveServeOptions({ port: 9123, host: "127.0.0.1" })).toEqual({ port: 9123, host: "127.0.0.1" });
      });
    });
  });

  test("startServeServer binds the PORT env port", () => {
    withEnv("PORT", "48080", () => {
      const server = startServeServer({});
      try {
        expect(server.port).toBe(48080);
      } finally {
        server.stop(true);
      }
    });
  });
});

describe("serve publish (PUT)", () => {
  test("rejects publish without a key", async () => {
    const res = await handleServeRequest(req("PUT", "/api/v1/hooks", { name: "gitguard" }), undefined);
    expect(res.status).toBe(401);
  });

  test("rejects publish with a wrong key", async () => {
    const res = await handleServeRequest(req("PUT", "/api/v1/hooks", { name: "gitguard" }, { authorization: "Bearer wrong" }), "secret");
    expect(res.status).toBe(401);
  });

  test("accepts publish with the right key and updates the lock", async () => {
    const meta = getHook("gitguard")!;
    const res = await handleServeRequest(req("PUT", "/api/v1/hooks", { name: "gitguard" }, { authorization: "Bearer secret" }), "secret");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hook: { name: string; version: string; sha256: string } };
    expect(body.ok).toBe(true);
    expect(body.hook.name).toBe("gitguard");
    expect(body.hook.version).toBe(meta.version);
    const pin = readLock().hooks["gitguard"];
    expect(pin?.sha256).toBe(body.hook.sha256);
    expect(pin?.source).toBe("serve");
  });

  test("accepts x-api-key header", async () => {
    const res = await handleServeRequest(req("PUT", "/api/v1/hooks", { name: "gitguard" }, { "x-api-key": "secret" }), "secret");
    expect(res.status).toBe(200);
  });

  test("publish then run succeeds without re-trust (DB record and pin updated together)", async () => {
    const dir = customHookDir("pub-run");
    writeCustomHook(
      "pub-run",
      { name: "pub-run", version: "1.0.0", events: ["PostToolUse"], script: "script.ts" },
      `console.log(JSON.stringify({ ok: true }));`,
      "script.ts",
    );
    try {
      const { runHook } = await import("./index.js");
      const first = await runHook("pub-run", {});
      expect(first.output).toEqual({ ok: true });

      // Local content changes; the registry publishes the new bytes.
      writeFileSync(join(dir, "script.ts"), `console.log(JSON.stringify({ ok: "v2" }));`);
      const res = await handleServeRequest(
        req("PUT", "/api/v1/hooks", { name: "pub-run" }, { authorization: "Bearer secret" }),
        "secret",
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; hook: { sha256: string } };
      expect(body.hook.sha256).toMatch(/^[0-9a-f]{64}$/);

      // The very next run must succeed without re-trusting: publishing
      // updates the DB record, not only the lock pin.
      const second = await runHook("pub-run", {});
      expect(second.output).toEqual({ ok: "v2" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("GET /api/v1/lock returns the published lock", async () => {
    const res = await handleServeRequest(req("GET", "/api/v1/lock"), undefined);
    const body = (await res.json()) as { hooks: Record<string, { version: string; sha256: string; source: string }> };
    expect(body.hooks["gitguard"]?.source).toBe("serve");
    expect(body.hooks["gitguard"]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
