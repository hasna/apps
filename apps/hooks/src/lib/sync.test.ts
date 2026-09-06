import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { planSync, syncHooks } from "./sync.js";
import { readLock, sha256File, setPinnedHook, getHookRecord } from "./store.js";
import { resolveScriptPath } from "./resolve.js";
import { getHook } from "./registry.js";
import { closeDb, getDb } from "../db/index.js";
import { handleServeRequest } from "../serve.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-sync-test-"));

/**
 * Hermetic registry env for the remote-registry tests: a caller-built
 * dictionary (Keychain tier off) anchored on TEST_DIR (disk tier absent), so
 * the machine's real credential stores can never leak into a sync run.
 */
function remoteSyncEnv(base: string, key = "test-sync-key"): Record<string, string> {
  return { HOME: TEST_DIR, HASNA_HOOKS_API_URL: base, HASNA_HOOKS_API_KEY: key };
}

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
    const plan = await planSync({ env: { HOME: TEST_DIR, HASNA_HOOKS_LOCAL: "1" } });
    expect(plan.apiUrl).toBeNull();
    expect(plan.diff.added.length).toBeGreaterThanOrEqual(40);
    expect(plan.diff.added).toContain("gitguard");
    expect(plan.diff.updated).toHaveLength(0);
  });

  test("sync pins all bundled hooks with correct hashes and DB records", async () => {
    const plan = await syncHooks({ env: { HOME: TEST_DIR, HASNA_HOOKS_LOCAL: "1" } });
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
    const plan = await syncHooks({ env: { HOME: TEST_DIR, HASNA_HOOKS_LOCAL: "1" } });
    expect(plan.diff.added).toHaveLength(0);
    expect(plan.diff.updated).toHaveLength(0);
    expect(plan.diff.unchanged.length).toBeGreaterThanOrEqual(40);
  });

  test("dry-run changes nothing and reports dryRun:true on both paths (P2-16a)", async () => {
    const lockBefore = JSON.stringify(readLock());
    const plan = await syncHooks({ dryRun: true, env: { HOME: TEST_DIR, HASNA_HOOKS_LOCAL: "1" } });
    expect(plan.dryRun).toBe(true);
    expect(JSON.stringify(readLock())).toBe(lockBefore);
    // planSync with the dryRun flag must not hardcode false (the CLI used to
    // print "✓ Synced" during --dry-run because planSync returned dryRun:false).
    const planned = await planSync({ dryRun: true, env: { HOME: TEST_DIR, HASNA_HOOKS_LOCAL: "1" } });
    expect(planned.dryRun).toBe(true);
    expect(planned.diff).toEqual(plan.diff);
  });

  test("a drifted lock pin is repaired as updated on next sync", async () => {
    setPinnedHook("checktests", { version: getHook("checktests")!.version, sha256: "deadbeef", source: "bundled" });
    const plan = await syncHooks({ env: { HOME: TEST_DIR, HASNA_HOOKS_LOCAL: "1" } });
    expect(plan.diff.updated).toContain("checktests");
    const lock = readLock();
    expect(lock.hooks["checktests"]?.sha256).toBe(await sha256File(resolveScriptPath("checktests")!));
  });
});

describe("sync from remote registry (API URL configured)", () => {
  test("fail-closed: network failure exits with error and changes nothing", async () => {
    const lockBefore = JSON.stringify(readLock());
    try {
      // Strict pair: the URL is configured and the key resolves from the same
      // hermetic env — the fetch itself then fails on the dead port.
      await expect(syncHooks({ env: remoteSyncEnv("http://127.0.0.1:1") })).rejects.toThrow();
      expect(JSON.stringify(readLock())).toBe(lockBefore);
    } finally {}
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
      await expect(syncHooks({ env: remoteSyncEnv(base) })).rejects.toThrow(/failed with status 500/);
      expect(JSON.stringify(readLock())).toBe(lockBefore);
      expect(JSON.stringify(getHookRecord(getDb(), "stage-ok"))).toBe(dbBefore);
      expect(existsSync(join(TEST_DIR, "hooks", "stage-ok"))).toBe(false);
    } finally {
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
      await expect(syncHooks({ env: remoteSyncEnv(base) })).rejects.toThrow(/ambiguous/);
      expect(JSON.stringify(readLock())).toBe(lockBefore);
    } finally {
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
      await expect(syncHooks({ env: remoteSyncEnv(base) })).rejects.toThrow(/escapes the hook directory/);
      expect(existsSync(join(TEST_DIR, "escape.sh"))).toBe(false);
      expect(existsSync(join(TEST_DIR, "hooks", "escape-demo"))).toBe(false);
      expect(JSON.stringify(readLock())).toBe(lockBefore);
    } finally {
      server.stop(true);
    }
  });

  test("a one-line inline hook (script_kind) installs via registry sync and runs (P1-2)", async () => {
    const script = "console.log(JSON.stringify({ continue: true }));";
    const sha = createHash("sha256").update(script).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/catalog") {
          return Response.json({ hooks: [{ name: "inline-sync-demo", version: "1.0.0", sha256: sha }] });
        }
        if (url.pathname === "/api/v1/lock") {
          return Response.json({ hooks: { "inline-sync-demo": { version: "1.0.0", sha256: sha, source: "remote" } } });
        }
        if (url.pathname === "/api/v1/hooks/inline-sync-demo/1.0.0") {
          return Response.json({
            manifest: { name: "inline-sync-demo", version: "1.0.0", events: ["PostToolUse"], script, script_kind: "inline" },
            script,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const plan = await syncHooks({ env: remoteSyncEnv(base) });
      expect(plan.diff.added).toContain("inline-sync-demo");
      // The one-line inline body lands in script.ts — never a file named
      // after the script content (the round-2A ENOENT repro).
      const scriptPath = resolveScriptPath("inline-sync-demo")!;
      expect(scriptPath.endsWith("script.ts")).toBe(true);
      expect(existsSync(scriptPath)).toBe(true);
      expect(readFileSync(scriptPath, "utf-8")).toBe(script);
      expect(readLock().hooks["inline-sync-demo"]?.version).toBe("1.0.0");
      const { runHook } = await import("../index.js");
      const res = await runHook("inline-sync-demo", {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
        session_id: "s-inline",
      });
      expect(res.exitCode).toBe(0);
      expect((res.output as any).continue).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("a remote artifact whose manifest version disagrees with the lock is refused (P3-13)", async () => {
    const script = "console.log('version-lie');\n";
    const sha = createHash("sha256").update(script).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/catalog") {
          return Response.json({ hooks: [{ name: "version-lie-demo", version: "1.0.0", sha256: sha }] });
        }
        if (url.pathname === "/api/v1/lock") {
          return Response.json({ hooks: { "version-lie-demo": { version: "1.0.0", sha256: sha, source: "remote" } } });
        }
        if (url.pathname === "/api/v1/hooks/version-lie-demo/1.0.0") {
          return Response.json({
            manifest: { name: "version-lie-demo", version: "9.9.9", events: ["PostToolUse"], script: "script.ts" },
            script,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    const lockBefore = JSON.stringify(readLock());
    try {
      await expect(syncHooks({ env: remoteSyncEnv(base) })).rejects.toThrow(/declares a different version/);
      expect(existsSync(join(TEST_DIR, "hooks", "version-lie-demo"))).toBe(false);
      expect(JSON.stringify(readLock())).toBe(lockBefore);
    } finally {
      server.stop(true);
    }
  });

  test("a one-line inline hook installs via the serve registry (script_kind passthrough) (P1-2)", async () => {
    const script = "console.log(JSON.stringify({ continue: true }));";
    const name = "serve-inline-demo";
    const dir = join(TEST_DIR, "hooks", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      name,
      version: "1.0.0",
      events: ["PostToolUse"],
      script,
      script_kind: "inline",
    }));
    writeFileSync(join(dir, "script.ts"), script);
    const sha = createHash("sha256").update(script).digest("hex");
    setPinnedHook(name, { version: "1.0.0", sha256: sha, source: "custom" });

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return handleServeRequest(req, "test-serve-key");
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const { fetchPinnedHook } = await import("./sync.js");
      const result = await fetchPinnedHook(name, "1.0.0", base, "test-serve-key");
      expect(result.scriptPath).toContain("script.ts");
      const { runHook } = await import("../index.js");
      const res = await runHook(name, {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
        session_id: "s-serve-inline",
      });
      expect(res.exitCode).toBe(0);
      expect((res.output as any).continue).toBe(true);
    } finally {
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
      const result = await fetchPinnedHook("pin-demo", "1.0.0", base, "test-sync-key");
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
      await expect(fetchPinnedHook("pin-demo", "9.9.9", base, "test-sync-key")).rejects.toThrow(/not in the remote registry/);
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
      await expect(fetchPinnedHook("pin-demo", "1.0.0", base, "test-sync-key")).rejects.toThrow(/sha256 header/);
    } finally {
      server.stop(true);
    }
  });
});

describe("explicit older pins are preserved across sync (P2-9)", () => {
  test("a 1.0.0 explicit pin survives a sync whose remote latest is 2.0.0; an explicit update moves it", async () => {
    const scriptV1 = "console.log('pinned-v1');\n";
    const scriptV2 = "console.log('pinned-v2');\n";
    const shaV1 = createHash("sha256").update(scriptV1).digest("hex");
    const shaV2 = createHash("sha256").update(scriptV2).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/catalog") {
          return Response.json({ hooks: [{ name: "pin-preserve-demo", version: "2.0.0", sha256: shaV2 }] });
        }
        if (url.pathname === "/api/v1/lock") {
          return Response.json({
            hooks: { "pin-preserve-demo": { version: "2.0.0", sha256: shaV2, source: "remote", versions: ["1.0.0", "2.0.0"] } },
          });
        }
        if (url.pathname === "/api/v1/hooks/pin-preserve-demo/2.0.0") {
          return Response.json({
            manifest: { name: "pin-preserve-demo", version: "2.0.0", events: ["PostToolUse"], script: "script.ts" },
            script: scriptV2,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      // The user explicitly pinned 1.0.0 (fetchPinnedHook marks the lock
      // entry pinned:true).
      setPinnedHook("pin-preserve-demo", { version: "1.0.0", sha256: shaV1, source: "remote", pinned: true });
      const plan = await syncHooks({ env: remoteSyncEnv(base) });
      expect(plan.diff.unchanged).toContain("pin-preserve-demo");
      expect(plan.diff.updated).not.toContain("pin-preserve-demo");
      const lock = readLock();
      expect(lock.hooks["pin-preserve-demo"]?.version).toBe("1.0.0");
      expect(lock.hooks["pin-preserve-demo"]?.sha256).toBe(shaV1);
      // An EXPLICIT update moves the pin to the latest.
      const { fetchPinnedHook } = await import("./sync.js");
      await fetchPinnedHook("pin-preserve-demo", "2.0.0", base, "test-sync-key");
      expect(readLock().hooks["pin-preserve-demo"]?.version).toBe("2.0.0");
      expect(readLock().hooks["pin-preserve-demo"]?.sha256).toBe(shaV2);
    } finally {
      server.stop(true);
    }
  });

  test("a sync-maintained (non-explicit) pin still follows the remote latest", async () => {
    const scriptV1 = "console.log('pinned-v1');\n";
    const scriptV2 = "console.log('pinned-v2');\n";
    const shaV1 = createHash("sha256").update(scriptV1).digest("hex");
    const shaV2 = createHash("sha256").update(scriptV2).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/catalog") {
          return Response.json({ hooks: [{ name: "pin-follow-demo", version: "2.0.0", sha256: shaV2 }] });
        }
        if (url.pathname === "/api/v1/lock") {
          return Response.json({
            hooks: { "pin-follow-demo": { version: "2.0.0", sha256: shaV2, source: "remote", versions: ["1.0.0", "2.0.0"] } },
          });
        }
        if (url.pathname === "/api/v1/hooks/pin-follow-demo/2.0.0") {
          return Response.json({
            manifest: { name: "pin-follow-demo", version: "2.0.0", events: ["PostToolUse"], script: "script.ts" },
            script: scriptV2,
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      // An ordinary (sync-maintained) stale pin is still updated.
      setPinnedHook("pin-follow-demo", { version: "1.0.0", sha256: shaV1, source: "remote" });
      const plan = await syncHooks({ env: remoteSyncEnv(base) });
      expect(plan.diff.updated).toContain("pin-follow-demo");
      expect(readLock().hooks["pin-follow-demo"]?.version).toBe("2.0.0");
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
      const plan = await syncHooks({ env: remoteSyncEnv(base, "test-sentinel") });
      expect(plan.diff.added).toContain("locked-demo");
      expect(sawHeader).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("a URL-only configuration fails closed at resolution — the registry is never reached (STRICT PAIR)", async () => {
    let hit = false;
    const server = Bun.serve({
      port: 0,
      fetch() {
        hit = true;
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      await expect(syncHooks({ env: { HOME: TEST_DIR, HASNA_HOOKS_API_URL: base } })).rejects.toThrow(
        /REMOTE_API_KEY_MISSING/,
      );
      expect(hit).toBe(false);
    } finally {
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
      await expect(syncHooks({ env: remoteSyncEnv(base, "wrong-sentinel") })).rejects.toThrow(
        /registry requires API key — set HASNA_HOOKS_API_KEY, the Keychain item/,
      );
    } finally {
      server.stop(true);
    }
  });
});
