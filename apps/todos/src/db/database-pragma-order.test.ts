/**
 * Regression test for the pragma ordering in `openDatabase`.
 *
 * The bug: `PRAGMA busy_timeout` was set AFTER `PRAGMA journal_mode = WAL`.
 * Switching the journal mode takes a lock, so with no timeout yet in effect that
 * pragma failed INSTANTLY with SQLITE_BUSY whenever another connection held the
 * database — rather than waiting the 5 seconds the very next line was about to
 * grant it. The trigger is ordinary: a `todos serve` starting while a CLI process
 * still has the same file open.
 *
 * This test drives the REAL `getDatabase()`/`openDatabase()` code path on purpose.
 * A test that re-implemented the two pragmas locally would prove something about
 * SQLite and nothing about this repo — it would still pass with src/db/database.ts
 * reverted, which is exactly the hole this test exists to close.
 *
 * Determinism: with the wrong order the open fails at ~0ms regardless of machine
 * load, because it does not wait at all. With the right order it waits for the
 * holder to release and succeeds. There is no timing window in which correct code
 * fails, so this is not a load-sensitive test.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";

const REPO_ROOT = join(import.meta.dir, "..", "..");

/**
 * How long the fixture keeps the write lock. Comfortably below the 5000ms
 * busy_timeout under test, so correct code waits it out and succeeds, and
 * comfortably above any plausible gap between the holder announcing the lock and
 * this process attempting its open.
 */
const HOLD_MS = 3_000;

/**
 * Explicit budget, because this test spawns a subprocess and bun's default is
 * 5000ms — less than HOLD_MS alone. Covers a cold `bun run` of the fixture, the
 * 3s hold, and the 68 schema migrations `openDatabase` runs once the lock frees,
 * with room for a loaded machine.
 */
const BUDGET_MS = 60_000;

/**
 * Floor proving the open actually CONTENDED rather than sailing through after the
 * holder had already released. Without this, a machine slow enough to miss the
 * hold window would report a silent false pass on reverted code.
 */
const MIN_CONTENDED_WAIT_MS = 250;

let tmpDir: string;
let dbPath: string;
let previousDbPath: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "todos-pragma-order-"));
  dbPath = join(tmpDir, "contended.db");
  previousDbPath = process.env["TODOS_DB_PATH"];
  resetDatabase();
});

afterEach(() => {
  closeDatabase();
  resetDatabase();
  if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
  else process.env["TODOS_DB_PATH"] = previousDbPath;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("openDatabase pragma order", () => {
  test("waits for a held write lock instead of failing instantly with SQLITE_BUSY", async () => {
    // Seed the one current schema before the holder takes its lock. A non-empty
    // unmarked file is intentionally rejected as ambiguous by normal startup.
    process.env["TODOS_DB_PATH"] = dbPath;
    getDatabase();
    closeDatabase();
    resetDatabase();

    const holder = Bun.spawn({
      cmd: ["bun", "run", "src/test/sqlite-lock-holder.ts", dbPath, String(HOLD_MS)],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // Wait for the lock to be genuinely held before contending for it.
      const decoder = new TextDecoder();
      let holderOut = "";
      let heldInDeleteMode = false;
      for await (const chunk of holder.stdout as ReadableStream<Uint8Array>) {
        holderOut += decoder.decode(chunk, { stream: true });
        if (/HOLDING journal_mode=(\w+)/.test(holderOut)) {
          heldInDeleteMode = /HOLDING journal_mode=delete/i.test(holderOut);
          break;
        }
      }

      expect(holderOut, "lock holder never reported HOLDING").toContain("HOLDING");
      // If the fixture failed to establish DELETE mode the database would already
      // be WAL, where the pragma order is a no-op and this test proves nothing.
      expect(heldInDeleteMode, `holder did not hold in delete mode: ${holderOut}`).toBe(true);

      const startedAt = Date.now();
      // With the pragmas in the wrong order this throws SQLITE_BUSY immediately.
      const db = getDatabase();
      const elapsedMs = Date.now() - startedAt;

      // Opened for real, not merely constructed.
      expect(db.query("SELECT 1 AS ok").get()).toEqual({ ok: 1 });

      // And WAL was actually reached, so the failing pragma really did execute.
      const mode = (db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
      expect(mode.toLowerCase()).toBe("wal");

      expect(
        elapsedMs,
        `open returned in ${elapsedMs}ms, so the ${HOLD_MS}ms lock was already released `
          + "and this run did not exercise lock contention",
      ).toBeGreaterThanOrEqual(MIN_CONTENDED_WAIT_MS);
    } finally {
      holder.kill();
      await holder.exited;
    }
  }, BUDGET_MS);
});
