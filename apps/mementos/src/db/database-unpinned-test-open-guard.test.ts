// ============================================================================
// Regression test for todos row 57b8b8c5 — "unpinned in-process tests resolve
// the LIVE LOCAL sqlite store".
//
// getDatabase(), called with no explicit dbPath argument and no DB_PATH env
// key set, silently opens whatever getDbPath() resolves to. Under `bun test`
// that is $HOME/.hasna/mementos/mementos.db — the real, shared, on-disk
// memory store (34MB+ of real rows on the machine this was found on) — with
// no error and no signal to the caller that anything unusual happened.
//
// This file exercises getDatabase() DIRECTLY, in its own process, deliberately
// NOT importing anything that pins MEMENTOS_DB_PATH at module scope (unlike
// database.test.ts / database-extra.test.ts, which set it on line 1). That is
// the point: it reproduces exactly the caller shape this row is about — a
// test file that forgets to pin a db path — rather than a shape that already
// has the fix applied by convention.
//
// Scope, stated so nobody reads more into this guard than it provides:
//   - It covers ONLY getDatabase() in this file (src/db/database.ts). It does
//     NOT cover src/lib/storage-sync.ts:616/697, which construct
//     `new SqliteAdapter(getDbPath())` directly and bypass getDatabase()
//     entirely. That is a named, un-fixed residual — see the todos row.
//   - It fires only when NODE_ENV === "test", matching the guard's own
//     condition. It does not change behaviour for CLI/MCP/server processes.
// ============================================================================

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

const ENV_KEYS_TO_CLEAR = [
  "MEMENTOS_DB_PATH",
  "HASNA_MEMENTOS_DB_PATH",
  "MEMENTOS_DB_SCOPE",
  "NODE_ENV",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS_TO_CLEAR) {
    saved[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS_TO_CLEAR) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  // Every other file in this suite relies on this pin surviving into the next
  // test file bun loads; restore it explicitly rather than leaving it unset.
  process.env["MEMENTOS_DB_PATH"] = ":memory:";
});

describe("getDatabase() unpinned-test-open guard (todos 57b8b8c5)", () => {
  test("REFUSES an unpinned default open when NODE_ENV=test", async () => {
    delete process.env["MEMENTOS_DB_PATH"];
    delete process.env["HASNA_MEMENTOS_DB_PATH"];
    process.env["NODE_ENV"] = "test";

    // Import fresh inside the test, after env is arranged, so module-level
    // side effects in other already-imported files cannot mask the guard.
    const { getDatabase, resetDatabase } = await import("./database.js");
    resetDatabase();

    expect(() => getDatabase()).toThrow(/REFUSING-UNPINNED-TEST-OPEN/);
  });

  test("names the resolved production path in the refusal message", async () => {
    delete process.env["MEMENTOS_DB_PATH"];
    delete process.env["HASNA_MEMENTOS_DB_PATH"];
    process.env["NODE_ENV"] = "test";

    const { getDatabase, resetDatabase, getDbPath } = await import("./database.js");
    resetDatabase();

    let message = "";
    try {
      getDatabase();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain(getDbPath());
  });

  test("ARM B (control) — an explicit MEMENTOS_DB_PATH still opens normally", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const scratch = mkdtempSync(join(tmpdir(), "mementos-guard-test-"));
    process.env["MEMENTOS_DB_PATH"] = join(scratch, "scratch.db");
    process.env["NODE_ENV"] = "test";

    const { getDatabase, resetDatabase } = await import("./database.js");
    resetDatabase();

    expect(() => getDatabase()).not.toThrow();
  });

  test("ARM C (control) — an explicit dbPath argument still opens normally", async () => {
    delete process.env["MEMENTOS_DB_PATH"];
    delete process.env["HASNA_MEMENTOS_DB_PATH"];
    process.env["NODE_ENV"] = "test";

    const { getDatabase, resetDatabase } = await import("./database.js");
    resetDatabase();

    expect(() => getDatabase(":memory:")).not.toThrow();
  });

  test("ARM D — outside NODE_ENV=test the test guard is silent; the fail-closed store gate refuses instead", async () => {
    // The 2026-09-04 fail-closed ruling removed the production local default:
    // a client that reaches the DEFAULT local path with no API env and no
    // explicit DB_PATH is refused by `assertClientStoreConfigured()` (owner
    // ruling; getDatabase default-path fallthrough), even when a
    // `.mementos/mementos.db` would be discoverable. This control pins the
    // SPLIT between the two guards: NODE_ENV=test yields the unpinned-test
    // message (asserted in the arms above), anything else yields the
    // fail-closed MementosStoreConfigError naming the required env — and never
    // an open. A scratch dir with its own `.mementos/mementos.db` placeholder
    // keeps the resolution target obvious without touching $HOME.
    const { mkdtempSync, mkdirSync, writeFileSync, closeSync, openSync } =
      await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const scratch = mkdtempSync(join(tmpdir(), "mementos-guard-armd-"));
    mkdirSync(join(scratch, ".mementos"), { recursive: true });
    // An empty file is a valid (empty) SQLite database on open.
    closeSync(openSync(join(scratch, ".mementos", "mementos.db"), "w"));
    writeFileSync(join(scratch, ".mementos", "mementos.db"), "");

    delete process.env["MEMENTOS_DB_PATH"];
    delete process.env["HASNA_MEMENTOS_DB_PATH"];
    delete process.env["MEMENTOS_DB_SCOPE"];
    delete process.env["MEMENTOS_LOCAL"];
    delete process.env["HASNA_MEMENTOS_LOCAL"];
    delete process.env["NODE_ENV"];

    const originalCwd = process.cwd();
    const { getDatabase, resetDatabase, closeDatabase, getDbPath } =
      await import("./database.js");
    resetDatabase();

    try {
      process.chdir(scratch);
      // Sanity: resolution WOULD land on the scratch file, not $HOME.
      // (realpathSync both sides: macOS /var is a symlink to /private/var, and
      // process.cwd() after chdir reports the canonical form.)
      const { realpathSync } = await import("node:fs");
      expect(realpathSync(getDbPath())).toBe(
        realpathSync(join(scratch, ".mementos", "mementos.db")),
      );

      let message = "";
      let code = "";
      try {
        getDatabase();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
        code = (e as { code?: string }).code ?? "";
      }
      // The test-scoped guard is silent outside NODE_ENV=test ...
      expect(message).not.toContain("REFUSING-UNPINNED-TEST-OPEN");
      // ... but the fail-closed store gate refuses the unconfigured open and
      // names the required env. The refusal message alone is the actionable
      // error a fleet CLI must show; the default local file is never opened.
      expect(code).toBe("MEMENTOS_STORE_CONFIG");
      expect(message).toContain("HASNA_MEMENTOS_API_URL");
      expect(message).toContain("HASNA_MEMENTOS_API_KEY");
    } finally {
      closeDatabase();
      process.chdir(originalCwd);
    }
  });
});
