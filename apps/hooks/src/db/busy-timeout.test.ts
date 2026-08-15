/**
 * Regression: SQLITE_BUSY under concurrent hook runs (QA-4 bug 09094299:
 * 6/10 parallel runs failed at the default 0ms busy timeout). getDb must open
 * with PRAGMA busy_timeout=5000 so concurrent writers serialize instead of
 * failing. Ten parallel real CLI runs must all exit 0.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { closeDb, getDb, getDbPath } from "./index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-busy-test-"));
const DATA_DIR = join(TEST_DIR, "data");
const DB_PATH = join(DATA_DIR, "hooks.db");
const CLI = join(import.meta.dir, "..", "..", "src", "cli", "index.tsx");

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = DATA_DIR;
  process.env.HASNA_HOOKS_DB_PATH = DB_PATH;
  mkdirSync(DATA_DIR, { recursive: true });
  const hookDir = join(DATA_DIR, "hooks", "busy-demo");
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(join(hookDir, "manifest.json"), JSON.stringify({
    name: "busy-demo",
    version: "1.0.0",
    events: ["PreToolUse"],
    script: "script.ts",
  }));
  writeFileSync(join(hookDir, "script.ts"), `console.log(JSON.stringify({ continue: true }));\n`);
  // Pin it so the run path is a pure write-refresh, like a real fire.
  const { setPinnedHook, sha256Of } = require("../lib/store.js");
  const content = require("fs").readFileSync(join(hookDir, "script.ts"));
  setPinnedHook("busy-demo", { version: "1.0.0", sha256: sha256Of(content), source: "custom" });
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("SQLITE_BUSY fix (QA-4 bug 09094299)", () => {
  test("getDb opens with busy_timeout=5000", () => {
    closeDb();
    const db = getDb();
    const row = db.query("SELECT * FROM pragma_busy_timeout").get() as { timeout: number };
    expect(row.timeout).toBe(5000);
    const wal = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(wal.journal_mode.toLowerCase()).toBe("wal");
  });

  test("10 parallel CLI hook runs all exit 0", async () => {
    const runs = Array.from({ length: 10 }, (_, i) =>
      Bun.spawn(["bun", "run", CLI, "run", "busy-demo"], {
        cwd: join(import.meta.dir, "..", ".."),
        stdin: new Response(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", command: "ls" })),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HASNA_HOOKS_DATA_DIR: DATA_DIR,
          HASNA_HOOKS_DB_PATH: DB_PATH,
          NO_COLOR: "1",
        },
      }),
    );
    const results = await Promise.all(runs.map(async (p) => {
      const [out, err] = await Promise.all([new Response(p.stdout as ReadableStream).text(), new Response(p.stderr as ReadableStream).text()]);
      const code = await p.exited;
      return { code, out, err };
    }));
    for (const [i, r] of results.entries()) {
      expect(r.code, `run ${i} failed: ${r.err}`).toBe(0);
    }
    // And every run left its event row (10 rows for busy-demo).
    const db = getDb();
    const count = db.query("SELECT COUNT(*) AS n FROM hook_events WHERE hook_name = 'busy-demo'").get() as { n: number };
    expect(count.n).toBe(10);
  });
});
