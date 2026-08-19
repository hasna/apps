import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  databaseUrlPresent,
  defaultSqlitePath,
  resolveDatabaseDsn,
  resolveDbPath,
  scrubDatabaseDsn,
} from "../src/config.js";

/**
 * Direct tests for the DSN/path resolution half of src/config.ts (the storage
 * MODE resolution is covered by test/config.test.ts). Pins the *_DATABASE_URL
 * vs *_DATABASE_URL_FILE precedence, the DSN scrub, and the DB path override.
 */

let dir: string;

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "access-config-"));
}

afterEach(() => {
  delete process.env["HASNA_ACCESS_DATABASE_URL"];
  delete process.env["ACCESS_DATABASE_URL"];
  delete process.env["HASNA_ACCESS_DATABASE_URL_FILE"];
  delete process.env["ACCESS_DATABASE_URL_FILE"];
  delete process.env["HASNA_ACCESS_DB_PATH"];
  delete process.env["ACCESS_DB_PATH"];
  if (dir) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  dir = undefined as never;
});

describe("databaseUrlPresent", () => {
  it("is true for the prefixed and bare URL env forms", () => {
    expect(databaseUrlPresent({ HASNA_ACCESS_DATABASE_URL: "postgres://x" })).toBe(true);
    expect(databaseUrlPresent({ ACCESS_DATABASE_URL: "postgres://x" })).toBe(true);
  });

  it("is true for the URL_FILE forms", () => {
    expect(databaseUrlPresent({ HASNA_ACCESS_DATABASE_URL_FILE: "/mount/dsn" })).toBe(true);
    expect(databaseUrlPresent({ ACCESS_DATABASE_URL_FILE: "/mount/dsn" })).toBe(true);
  });

  it("is false for empty/whitespace values and for no config", () => {
    expect(databaseUrlPresent({})).toBe(false);
    expect(databaseUrlPresent({ HASNA_ACCESS_DATABASE_URL: "  " })).toBe(false);
    expect(databaseUrlPresent({ ACCESS_DATABASE_URL_FILE: "" })).toBe(false);
  });
});

describe("resolveDatabaseDsn — file over env, trimmed", () => {
  it("returns the env URL when no file is configured", () => {
    expect(resolveDatabaseDsn({ HASNA_ACCESS_DATABASE_URL: "postgres://env" })).toBe("postgres://env");
    expect(resolveDatabaseDsn({ ACCESS_DATABASE_URL: "postgres://bare" })).toBe("postgres://bare");
  });

  it("prefers a present URL_FILE mount over the env URL", () => {
    dir = freshDir();
    const file = join(dir, "dsn");
    writeFileSync(file, "postgres://from-file\n");
    expect(
      resolveDatabaseDsn({ HASNA_ACCESS_DATABASE_URL: "postgres://env", HASNA_ACCESS_DATABASE_URL_FILE: file }),
    ).toBe("postgres://from-file");
  });

  it("falls back to the env URL when the file path is missing or empty", () => {
    dir = freshDir();
    const missing = join(dir, "missing");
    const empty = join(dir, "empty");
    writeFileSync(empty, "   \n");
    expect(resolveDatabaseDsn({ HASNA_ACCESS_DATABASE_URL: "postgres://env", HASNA_ACCESS_DATABASE_URL_FILE: missing })).toBe(
      "postgres://env",
    );
    expect(resolveDatabaseDsn({ HASNA_ACCESS_DATABASE_URL: "postgres://env", HASNA_ACCESS_DATABASE_URL_FILE: empty })).toBe(
      "postgres://env",
    );
  });

  it("returns undefined when nothing is configured", () => {
    expect(resolveDatabaseDsn({})).toBeUndefined();
  });

  it("fails closed when the configured file path is a directory", () => {
    dir = freshDir();
    // readFileSync on a directory raises; the error must propagate rather than
    // silently falling back to an inline URL.
    expect(() => resolveDatabaseDsn({ HASNA_ACCESS_DATABASE_URL: "postgres://env", HASNA_ACCESS_DATABASE_URL_FILE: dir })).toThrow();
  });
});

describe("scrubDatabaseDsn", () => {
  it("removes both URL env forms but leaves the FILE key and unrelated vars", () => {
    const env: Record<string, string> = {
      HASNA_ACCESS_DATABASE_URL: "postgres://secret",
      ACCESS_DATABASE_URL: "postgres://secret",
      HASNA_ACCESS_DATABASE_URL_FILE: "/mount/dsn",
      OTHER_VAR: "keep",
    };
    scrubDatabaseDsn(env);
    expect(env).toEqual({ HASNA_ACCESS_DATABASE_URL_FILE: "/mount/dsn", OTHER_VAR: "keep" });
  });
});

describe("resolveDbPath / defaultSqlitePath", () => {
  it("honors the HASNA_ACCESS_DB_PATH override", () => {
    expect(resolveDbPath({ HASNA_ACCESS_DB_PATH: "/tmp/custom.db" })).toBe("/tmp/custom.db");
    expect(resolveDbPath({ ACCESS_DB_PATH: "/tmp/bare.db" })).toBe("/tmp/bare.db");
  });

  it("falls back to the canonical default path", () => {
    expect(resolveDbPath({})).toBe(defaultSqlitePath());
    expect(defaultSqlitePath()).toMatch(/\.hasna[\\/]access[\\/]access\.db$/);
  });

  it("ignores whitespace-only overrides", () => {
    expect(resolveDbPath({ HASNA_ACCESS_DB_PATH: "   " })).toBe(defaultSqlitePath());
  });
});
