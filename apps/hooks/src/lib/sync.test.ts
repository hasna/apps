import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createHash } from "crypto";
import { existsSync, mkdtempSync, rmSync } from "fs";
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

  test("dry-run changes nothing", async () => {
    const lockBefore = JSON.stringify(readLock());
    const plan = await syncHooks({ dryRun: true });
    expect(plan.dryRun).toBe(true);
    expect(JSON.stringify(readLock())).toBe(lockBefore);
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
