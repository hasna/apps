// Coverage lane (tests-coverage-sol workflow, Sol advisory Priority 3): the
// storage-configuration surface (src/config.ts) had no direct tests at
// origin/main. These tests pin: resolveServerBackend for DATABASE_URL under both
// the HASNA_HOLDINGS_ and the bare HOLDINGS_ prefixes and for the
// HASNA_HOLDINGS_DATABASE_URL_FILE mount, the sqlite fallback, defaultSqlitePath,
// resolveDbPath precedence, the unreadable-FILE error, scrubDatabaseUrl deleting
// both prefix keys, whitespace-trimmed presence — and the integration arm Sol
// names: the DSN is scrubbed from process.env AFTER openDatabase connects, so
// child processes cannot read it (§2.4).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  databaseUrlPresent,
  defaultSqlitePath,
  resolveDatabaseUrl,
  resolveDbPath,
  resolveServerBackend,
  scrubDatabaseUrl,
} from "../src/config.js";
import { getHoldingsAppHome } from "../src/core/app-home.js";
import { openDatabase } from "../src/db/database.js";

// Isolate to a throwaway HOME so the default-sqlite-path assertions never depend
// on whether this machine already has a migrated store under the real home.
const testHome = join(tmpdir(), `holdings-cfg-home-${Date.now()}`);
mkdirSync(join(testHome, ".hasna", "holdings"), { recursive: true });
const savedHome = process.env.HOME;
process.env.HOME = testHome;
afterAll(() => {
  process.env.HOME = savedHome;
  rmSync(testHome, { recursive: true, force: true });
});

const URL_KEY = "HASNA_HOLDINGS_DATABASE_URL";
const BARE_URL_KEY = "HOLDINGS_DATABASE_URL";
const URL_FILE_KEY = "HASNA_HOLDINGS_DATABASE_URL_FILE";
const DB_PATH_KEY = "HASNA_HOLDINGS_DB_PATH";
const BARE_DB_PATH_KEY = "HOLDINGS_DB_PATH";

let tmp: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "holdings-cfg-"));
  saved = {
    [URL_KEY]: process.env[URL_KEY],
    [BARE_URL_KEY]: process.env[BARE_URL_KEY],
    [URL_FILE_KEY]: process.env[URL_FILE_KEY],
    [DB_PATH_KEY]: process.env[DB_PATH_KEY],
    [BARE_DB_PATH_KEY]: process.env[BARE_DB_PATH_KEY],
  };
  for (const key of Object.keys(saved)) delete process.env[key];
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("server backend resolution (sqlite | postgresql)", () => {
  it("defaults to sqlite when no database URL is present", () => {
    expect(resolveServerBackend({})).toBe("sqlite");
    expect(databaseUrlPresent({})).toBe(false);
  });

  it("selects postgresql for the HASNA_HOLDINGS_ and the bare HOLDINGS_ DATABASE_URL", () => {
    expect(resolveServerBackend({ [URL_KEY]: "postgres://u:p@h/db?sslmode=verify-full" })).toBe("postgresql");
    expect(resolveServerBackend({ [BARE_URL_KEY]: "postgres://u:p@h/db?sslmode=verify-full" })).toBe("postgresql");
  });

  it("selects postgresql when only a *_FILE mount for the DSN is present", () => {
    expect(resolveServerBackend({ [URL_FILE_KEY]: "/run/secrets/dsn" })).toBe("postgresql");
    expect(databaseUrlPresent({ [URL_FILE_KEY]: "/run/secrets/dsn" })).toBe(true);
  });

  it("the HASNA_ prefixed key wins when both prefixes are set", () => {
    expect(resolveServerBackend({ [URL_KEY]: "postgres://canonical", [BARE_URL_KEY]: "postgres://legacy" })).toBe("postgresql");
    expect(resolveDatabaseUrl({ [URL_KEY]: "postgres://canonical", [BARE_URL_KEY]: "postgres://legacy" })).toBe("postgres://canonical");
  });

  it("ignores whitespace-only values (presence is trimmed, so a blank var is no backend)", () => {
    expect(resolveServerBackend({ [URL_KEY]: "   " })).toBe("sqlite");
    expect(databaseUrlPresent({ [URL_KEY]: "   " })).toBe(false);
  });
});

describe("sqlite path resolution", () => {
  it("defaultSqlitePath is the effective app home's holdings.db", () => {
    // Under the isolated HOME with no overrides the effective home is the legacy
    // ~/.hasna/holdings layout, so the default db path follows it.
    expect(defaultSqlitePath()).toBe(join(getHoldingsAppHome(), "holdings.db"));
    expect(defaultSqlitePath()).toBe(join(testHome, ".hasna", "holdings", "holdings.db"));
  });

  it("HASNA_HOLDINGS_DB_PATH wins over the bare HOLDINGS_DB_PATH; bare is honored alone; default as fallback", () => {
    expect(resolveDbPath({ [DB_PATH_KEY]: "/canonical.db", [BARE_DB_PATH_KEY]: "/legacy.db" })).toBe("/canonical.db");
    expect(resolveDbPath({ [BARE_DB_PATH_KEY]: "/legacy.db" })).toBe("/legacy.db");
    expect(resolveDbPath({})).toBe(defaultSqlitePath());
    expect(resolveDbPath({ [DB_PATH_KEY]: "   " })).toBe(defaultSqlitePath());
  });
});

describe("DSN resolution and scrubbing (§2.4)", () => {
  it("resolves the DSN from either prefix and trims whitespace", () => {
    expect(resolveDatabaseUrl({ [URL_KEY]: "  postgres://a  " })).toBe("postgres://a");
    expect(resolveDatabaseUrl({ [BARE_URL_KEY]: "postgres://b" })).toBe("postgres://b");
  });

  it("prefers the *_FILE mount over a broadcast env var and trims it", () => {
    const file = join(tmp, "dsn");
    writeFileSync(file, "  postgres://from-file?sslmode=verify-full\n");
    expect(resolveDatabaseUrl({ [URL_KEY]: "postgres://broadcast", [URL_FILE_KEY]: file })).toBe("postgres://from-file?sslmode=verify-full");
  });

  it("throws when the configured *_FILE mount is unreadable — never silently falls back", () => {
    expect(() => resolveDatabaseUrl({ [URL_FILE_KEY]: join(tmp, "missing") })).toThrow(/Could not read/);
  });

  it("scrubDatabaseUrl deletes both DSN env keys and preserves unrelated config", () => {
    const env: Record<string, string> = {
      [URL_KEY]: "postgres://u:p@h/db",
      [BARE_URL_KEY]: "postgres://u:p@h/db",
      [URL_FILE_KEY]: "/run/secrets/dsn",
      [DB_PATH_KEY]: "/tmp/x.db",
    };
    scrubDatabaseUrl(env);
    expect(URL_KEY in env).toBe(false);
    expect(BARE_URL_KEY in env).toBe(false);
    expect(env[URL_FILE_KEY]).toBe("/run/secrets/dsn");
    expect(env[DB_PATH_KEY]).toBe("/tmp/x.db");
  });

  it("scrubDatabaseUrl is a no-op when nothing is set", () => {
    const env: Record<string, string> = { OTHER: "x" };
    scrubDatabaseUrl(env);
    expect(env).toEqual({ OTHER: "x" });
  });

  it("INTEGRATION: openDatabase scrubs the broadcast DSN from process.env after connecting", () => {
    // An explicit path bypasses the postgresql PURE-REMOTE guard, so the sqlite
    // path runs and must scrub the DSN it would otherwise leave for child processes.
    process.env[URL_KEY] = "postgres://u:p@h/db?sslmode=verify-full";
    const db = openDatabase(":memory:");
    try {
      expect(URL_KEY in process.env).toBe(false);
      expect(BARE_URL_KEY in process.env).toBe(false);
    } finally {
      db.close();
    }
  });
});
