// Test-gap remediation: agent-authored (SOL consult refused — model at capacity).
// Covers src/core/paths.ts, which had NO tests at all: data-dir creation,
// legacy-dir migration, the DB path override env, and ~ expansion are the
// on-box bootstrapping every local-mode command depends on.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  HASNA_ATTACHMENTS_DB_PATH_ENV,
  ensureAttachmentsDataDir,
  getAttachmentsDbPath,
} from "./paths";

const ORIGINAL_HOME = process.env.HOME;

function makeTempHome(): string {
  return join(tmpdir(), `attachments-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe("paths (HOME-pinned)", () => {
  let home: string;

  beforeEach(() => {
    home = makeTempHome();
    mkdirSync(home, { recursive: true });
    process.env.HOME = home;
    delete process.env[HASNA_ATTACHMENTS_DB_PATH_ENV];
    delete (process.env as Record<string, string | undefined>)["USERPROFILE"];
  });

  afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIGINAL_HOME;
    delete process.env[HASNA_ATTACHMENTS_DB_PATH_ENV];
    rmSync(home, { recursive: true, force: true });
  });

  test("ensureAttachmentsDataDir creates the canonical dir under HOME", () => {
    const dir = ensureAttachmentsDataDir();
    expect(dir).toBe(join(home, ".hasna", "attachments"));
    expect(existsSync(dir)).toBe(true);
  });

  test("getAttachmentsDbPath returns canonical db.sqlite and creates the dir", () => {
    const dbPath = getAttachmentsDbPath();
    expect(dbPath).toBe(join(home, ".hasna", "attachments", "db.sqlite"));
    expect(existsSync(join(home, ".hasna", "attachments"))).toBe(true);
  });

  test("legacy attachments.db is migrated when no new db exists", () => {
    const legacy = join(home, ".attachments");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "attachments.db"), Buffer.from("legacy-bytes"));

    const dbPath = getAttachmentsDbPath();
    expect(existsSync(dbPath)).toBe(true);
    expect(readFileSync(dbPath)).toEqual(Buffer.from("legacy-bytes"));
  });

  test("legacy db is NOT copied when a new db already exists (new data wins)", () => {
    const dbPath = getAttachmentsDbPath();
    mkdirSync(join(home, ".hasna", "attachments"), { recursive: true });
    writeFileSync(dbPath, Buffer.from("fresh-bytes"));

    const legacy = join(home, ".attachments");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "attachments.db"), Buffer.from("legacy-bytes"));

    expect(getAttachmentsDbPath()).toBe(dbPath);
    expect(readFileSync(dbPath)).toEqual(Buffer.from("fresh-bytes"));
  });

  test("both legacy dirs are scanned, newest-effective copy order", () => {
    const first = join(home, ".open-attachments");
    const second = join(home, ".attachments");
    mkdirSync(first, { recursive: true });
    mkdirSync(second, { recursive: true });
    // Only .attachments holds a db — the copy must find it regardless of which
    // legacy dir is scanned first.
    writeFileSync(join(second, "attachments.db"), Buffer.from("from-second"));

    expect(readFileSync(getAttachmentsDbPath())).toEqual(Buffer.from("from-second"));
  });

  test("db path override expands ~ to HOME", () => {
    process.env[HASNA_ATTACHMENTS_DB_PATH_ENV] = "~/custom/db.sqlite";
    const dbPath = getAttachmentsDbPath();
    expect(dbPath).toBe(join(home, "custom", "db.sqlite"));
    expect(existsSync(join(home, "custom"))).toBe(true);
  });

  test("db path override creates its parent dir and migrates legacy db into it", () => {
    const legacy = join(home, ".attachments");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "attachments.db"), Buffer.from("legacy-bytes"));

    process.env[HASNA_ATTACHMENTS_DB_PATH_ENV] = join(home, "custom", "db.sqlite");
    const dbPath = getAttachmentsDbPath();
    expect(existsSync(dbPath)).toBe(true);
    expect(readFileSync(dbPath)).toEqual(Buffer.from("legacy-bytes"));
  });

  test("legacy migration failure is best-effort and does not throw", () => {
    // A legacy dir that is actually a FILE (not a directory) must not break boot.
    writeFileSync(join(home, ".attachments"), "i am a file, not a dir");
    const dbPath = getAttachmentsDbPath();
    expect(dbPath).toBe(join(home, ".hasna", "attachments", "db.sqlite"));
  });
});
