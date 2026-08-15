import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { planSync, syncHooks } from "./sync.js";
import { readLock, sha256File, setPinnedHook, getHookRecord } from "./store.js";
import { resolveScriptPath } from "./resolve.js";
import { getHook } from "./registry.js";
import { closeDb, getDb } from "../db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-sync-test-"));

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

describe("sync from bundled registry (no API URL)", () => {
  test("plan lists bundled hooks as added when nothing is pinned", async () => {
    const plan = await planSync();
    expect(plan.apiUrl).toBeNull();
    expect(plan.diff.added.length).toBeGreaterThanOrEqual(40);
    expect(plan.diff.added).toContain("gitguard");
    expect(plan.diff.updated).toHaveLength(0);
  });

  test("sync pins all bundled hooks with correct hashes and DB records", async () => {
    const plan = await syncHooks();
    expect(plan.diff.added.length).toBeGreaterThanOrEqual(40);
    const lock = readLock();
    expect(lock.hooks["gitguard"]?.source).toBe("bundled");
    expect(lock.hooks["gitguard"]?.version).toBe(getHook("gitguard")!.version);
    const scriptPath = resolveScriptPath("gitguard")!;
    expect(lock.hooks["gitguard"]?.sha256).toBe(await sha256File(scriptPath));
    const record = getHookRecord(getDb(), "gitguard");
    expect(record?.sha256).toBe(lock.hooks["gitguard"]?.sha256);
    expect(record?.source_type).toBe("bundled");
  });

  test("second sync reports unchanged", async () => {
    const plan = await syncHooks();
    expect(plan.diff.added).toHaveLength(0);
    expect(plan.diff.updated).toHaveLength(0);
    expect(plan.diff.unchanged.length).toBeGreaterThanOrEqual(40);
  });

  test("dry-run changes nothing and reports dryRun:true on both paths (P2-16a)", async () => {
    const lockBefore = JSON.stringify(readLock());
    const plan = await syncHooks({ dryRun: true });
    expect(plan.dryRun).toBe(true);
    expect(JSON.stringify(readLock())).toBe(lockBefore);
    // planSync with the dryRun flag must not hardcode false (the CLI used to
    // print "✓ Synced" during --dry-run because planSync returned dryRun:false).
    const planned = await planSync({ dryRun: true });
    expect(planned.dryRun).toBe(true);
    expect(planned.diff).toEqual(plan.diff);
  });

  test("a drifted lock pin is repaired as updated on next sync", async () => {
    setPinnedHook("checktests", { version: getHook("checktests")!.version, sha256: "deadbeef", source: "bundled" });
    const plan = await syncHooks();
    expect(plan.diff.updated).toContain("checktests");
    const lock = readLock();
    expect(lock.hooks["checktests"]?.sha256).toBe(await sha256File(resolveScriptPath("checktests")!));
  });
});

describe("sync from remote registry (API URL configured)", () => {
  test("fail-closed: network failure exits with error and changes nothing", async () => {
    process.env.HASNA_HOOKS_API_URL = "http://127.0.0.1:1";
    const lockBefore = JSON.stringify(readLock());
    try {
      await expect(syncHooks()).rejects.toThrow();
      expect(JSON.stringify(readLock())).toBe(lockBefore);
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
    }
  });

  test("stage failure leaves the store fully unchanged (P1-9)", async () => {
    const sha = createHash("sha256").update("console.log('a');\n").digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/catalog") {
          return Response.json({
            hooks: [
              { name: "stage-ok", version: "1.0.0", sha256: sha },
              { name: "stage-boom", version: "1.0.0", sha256: sha },
            ],
          });
        }
        if (url.pathname === "/api/v1/lock") {
          return Response.json({
            hooks: {
              "stage-ok": { version: "1.0.0", sha256: sha, source: "remote" },
              "stage-boom": { version: "1.0.0", sha256: sha, source: "remote" },
            },
          });
        }
        if (url.pathname === "/api/v1/hooks/stage-ok/1.0.0") {
          return Response.json({
            manifest: { name: "stage-ok", version: "1.0.0", events: ["PostToolUse"], script: "script.ts" },
            script: "console.log('a');\n",
          });
        }
        // The second artifact fails AFTER the first was fully fetched+validated:
        // staging must abort before any write, so the first hook is NOT written.
        return new Response("internal error", { status: 500 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    const lockBefore = JSON.stringify(readLock());
    const dbBefore = JSON.stringify(getHookRecord(getDb(), "stage-ok"));
    try {
      process.env.HASNA_HOOKS_API_URL = base;
      await expect(syncHooks()).rejects.toThrow(/failed with status 500/);
      expect(JSON.stringify(readLock())).toBe(lockBefore);
      expect(JSON.stringify(getHookRecord(getDb(), "stage-ok"))).toBe(dbBefore);
      expect(existsSync(join(TEST_DIR, "hooks", "stage-ok"))).toBe(false);
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      server.stop(true);
    }
  });

  test("commit failure before the lock write leaves lock and DB unchanged (P1-9)", async () => {
    const shaOk = createHash("sha256").update("console.log('commit-a');\n").digest("hex");
    const shaBad = createHash("sha256").update("console.log('commit-b');\n").digest("hex");
    // A staged list where the second item's script path collides with a
    // directory, so writeCustomHook throws mid-commit (after the first hook
    // was already written to disk).
    const boomDir = join(TEST_DIR, "hooks", "commit-boom");
    mkdirSync(join(boomDir, "script.ts"), { recursive: true });

    const { commitSyncArtifacts } = await import("./sync.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manifest = { name: "x", version: "1.0.0", events: ["PostToolUse"], script: "script.ts" } as any;
    const staged = [
      {
        name: "commit-ok",
        version: "1.0.0",
        sha256: shaOk,
        source: "remote",
        manifest,
        scriptContent: "console.log('commit-a');\n",
        scriptRel: "script.ts",
      },
      {
        name: "commit-boom",
        version: "1.0.0",
        sha256: shaBad,
        source: "remote",
        manifest,
        scriptContent: "console.log('commit-b');\n",
        scriptRel: "script.ts",
      },
    ];
    const remoteLock = {
      hooks: {
        "commit-ok": { version: "1.0.0", sha256: shaOk, source: "remote" },
        "commit-boom": { version: "1.0.0", sha256: shaBad, source: "remote" },
      },
    };
    const lockBefore = JSON.stringify(readLock());
    try {
      await expect(commitSyncArtifacts(staged, "http://unused", remoteLock as never)).rejects.toThrow();
      expect(JSON.stringify(readLock())).toBe(lockBefore);
      expect(getHookRecord(getDb(), "commit-boom")).toBeNull();
      expect(getHookRecord(getDb(), "commit-ok")).toBeNull();
    } finally {
      rmSync(join(TEST_DIR, "hooks", "commit-ok"), { recursive: true, force: true });
      rmSync(boomDir, { recursive: true, force: true });
    }
  });

  test("ambiguous remote state (lock ≠ catalog latest) is refused, not guessed (P2-11)", async () => {
    const sha = createHash("sha256").update("console.log('amb');\n").digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/catalog") {
          return Response.json({ hooks: [{ name: "amb-demo", version: "1.1.0", sha256: sha }] });
        }
        if (url.pathname === "/api/v1/lock") {
          return Response.json({ hooks: { "amb-demo": { version: "1.0.0", sha256: sha, source: "remote" } } });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    const lockBefore = JSON.stringify(readLock());
    try {
      process.env.HASNA_HOOKS_API_URL = base;
      await expect(syncHooks()).rejects.toThrow(/ambiguous/);
      expect(JSON.stringify(readLock())).toBe(lockBefore);
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      server.stop(true);
    }
  });

  test("a remote manifest whose script escapes the hook dir refuses and writes nothing", async () => {
    const script = "echo pwned\n";
    const sha = createHash("sha256").update(script).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/catalog") {
          return Response.json({ hooks: [{ name: "escape-demo", version: "1.0.0", sha256: sha }] });
        }
        if (url.pathname === "/api/v1/lock") {
          return Response.json({ hooks: { "escape-demo": { version: "1.0.0", sha256: sha, source: "remote" } } });
        }
        if (url.pathname === "/api/v1/hooks/escape-demo/1.0.0") {
          return Response.json({
            manifest: { name: "escape-demo", version: "1.0.0", events: ["PostToolUse"], script: "../escape.sh" },
            script,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    const lockBefore = JSON.stringify(readLock());
    try {
      process.env.HASNA_HOOKS_API_URL = base;
      await expect(syncHooks()).rejects.toThrow(/escapes the hook directory/);
      expect(existsSync(join(TEST_DIR, "escape.sh"))).toBe(false);
      expect(existsSync(join(TEST_DIR, "hooks", "escape-demo"))).toBe(false);
      expect(JSON.stringify(readLock())).toBe(lockBefore);
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      server.stop(true);
    }
  });
});

describe("fetchPinnedHook with a versioned registry (P1-4)", () => {
  test("an older-than-latest pin fetches the exact version via its header sha and pins it", async () => {
    const scriptV1 = "console.log('pinned-v1');\n";
    const scriptV2 = "console.log('pinned-v2');\n";
    const shaV1 = createHash("sha256").update(scriptV1).digest("hex");
    const shaV2 = createHash("sha256").update(scriptV2).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/lock") {
          return Response.json({
            hooks: {
              "pin-demo": { version: "2.0.0", sha256: shaV2, source: "remote", versions: ["1.0.0", "2.0.0"] },
            },
          });
        }
        if (url.pathname === "/api/v1/hooks/pin-demo/1.0.0") {
          return new Response(JSON.stringify({
            manifest: { name: "pin-demo", version: "1.0.0", events: ["PostToolUse"], script: "script.ts" },
            script: scriptV1,
          }), { headers: { "x-hook-sha256": shaV1 } });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const { fetchPinnedHook } = await import("./sync.js");
      const result = await fetchPinnedHook("pin-demo", "1.0.0", base);
      expect(result.version).toBe("1.0.0");
      expect(result.sha256).toBe(shaV1);
      expect(result.scriptPath).toContain("pin-demo");
      const lock = readLock();
      expect(lock.hooks["pin-demo"]?.version).toBe("1.0.0");
      expect(lock.hooks["pin-demo"]?.sha256).toBe(shaV1);
      const record = getHookRecord(getDb(), "pin-demo");
      expect(record?.version).toBe("1.0.0");
      expect(record?.sha256).toBe(shaV1);
    } finally {
      server.stop(true);
    }
  });

  test("a version the registry never published is refused with the available list", async () => {
    const scriptV2 = "console.log('pinned-v2');\n";
    const shaV2 = createHash("sha256").update(scriptV2).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          hooks: {
            "pin-demo": { version: "2.0.0", sha256: shaV2, source: "remote", versions: ["2.0.0"] },
          },
        });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const { fetchPinnedHook } = await import("./sync.js");
      await expect(fetchPinnedHook("pin-demo", "9.9.9", base)).rejects.toThrow(/not in the remote registry/);
    } finally {
      server.stop(true);
    }
  });

  test("an older pin without a sha header is refused (never trusted unverified)", async () => {
    const scriptV1 = "console.log('pinned-v1');\n";
    const shaV2 = createHash("sha256").update("console.log('pinned-v2');\n").digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/lock") {
          return Response.json({
            hooks: { "pin-demo": { version: "2.0.0", sha256: shaV2, source: "remote", versions: ["1.0.0", "2.0.0"] } },
          });
        }
        if (url.pathname === "/api/v1/hooks/pin-demo/1.0.0") {
          return Response.json({
            manifest: { name: "pin-demo", version: "1.0.0", events: ["PostToolUse"], script: "script.ts" },
            script: scriptV1,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const { fetchPinnedHook } = await import("./sync.js");
      await expect(fetchPinnedHook("pin-demo", "1.0.0", base)).rejects.toThrow(/sha256 header/);
    } finally {
      server.stop(true);
    }
  });
});

describe("sync client sends the API key to a locked registry", () => {
  test("sends X-API-Key from env and syncs when the registry requires it", async () => {
    let sawHeader = false;
    const sha = createHash("sha256").update("console.log('locked');\n").digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (req.headers.get("x-api-key") !== "test-sentinel") {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }
        sawHeader = true;
        if (url.pathname === "/api/v1/catalog") {
          return Response.json({ hooks: [{ name: "locked-demo", version: "1.0.0", sha256: sha }] });
        }
        if (url.pathname === "/api/v1/lock") {
          return Response.json({ hooks: { "locked-demo": { version: "1.0.0", sha256: sha, source: "remote" } } });
        }
        if (url.pathname === "/api/v1/hooks/locked-demo/1.0.0") {
          return Response.json({
            manifest: { name: "locked-demo", version: "1.0.0", events: ["PostToolUse"], script: "script.ts" },
            script: "console.log('locked');\n",
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      process.env.HASNA_HOOKS_API_URL = base;
      process.env.HASNA_HOOKS_API_KEY = "test-sentinel";
      const plan = await syncHooks();
      expect(plan.diff.added).toContain("locked-demo");
      expect(sawHeader).toBe(true);
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      delete process.env.HASNA_HOOKS_API_KEY;
      server.stop(true);
    }
  });

  test("a 401 without a configured key fails with the clear registry-key error", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      process.env.HASNA_HOOKS_API_URL = base;
      delete process.env.HASNA_HOOKS_API_KEY;
      await expect(syncHooks()).rejects.toThrow(
        /registry requires API key — set HASNA_HOOKS_API_KEY or HOOKS_API_KEY/,
      );
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      server.stop(true);
    }
  });

  test("a 401 with a wrong key fails with the same clear error", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      process.env.HASNA_HOOKS_API_URL = base;
      process.env.HASNA_HOOKS_API_KEY = "wrong-sentinel";
      await expect(syncHooks()).rejects.toThrow(
        /registry requires API key — set HASNA_HOOKS_API_KEY or HOOKS_API_KEY/,
      );
    } finally {
      delete process.env.HASNA_HOOKS_API_URL;
      delete process.env.HASNA_HOOKS_API_KEY;
      server.stop(true);
    }
  });
});
