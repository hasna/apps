/**
 * Regression tests for P1-9: hooks.lock fail-closed + atomic writes.
 *
 * A malformed lock used to read as {hooks:{}} — the next sync would
 * re-trust every hook as if nothing had been pinned (fail-open). It must
 * now throw with a repair message, and lock writes must be atomic
 * (temp + rename) so a crash mid-write cannot produce a truncated lock.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readLock, writeLock, setPinnedHook, getPinnedHook, LockFileError } from "./store.js";
import { closeDb } from "../db/index.js";
import { getLockPath } from "../config.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-lock-test-"));

const originalDataDir = process.env.HASNA_HOOKS_DATA_DIR;
const originalLockPath = process.env.HASNA_HOOKS_LOCK_PATH;
const originalDbPath = process.env.HASNA_HOOKS_DB_PATH;

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
  delete process.env.HASNA_HOOKS_LOCK_PATH;
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.HASNA_HOOKS_DATA_DIR;
  else process.env.HASNA_HOOKS_DATA_DIR = originalDataDir;
  if (originalDbPath === undefined) delete process.env.HASNA_HOOKS_DB_PATH;
  else process.env.HASNA_HOOKS_DB_PATH = originalDbPath;
  if (originalLockPath === undefined) delete process.env.HASNA_HOOKS_LOCK_PATH;
  else process.env.HASNA_HOOKS_LOCK_PATH = originalLockPath;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("lock fail-closed (P1-9)", () => {
  test("a missing lock reads as an empty store (first run)", () => {
    expect(readLock()).toEqual({ hooks: {} });
  });

  test("invalid JSON in hooks.lock throws LockFileError with a repair message", () => {
    writeFileSync(getLockPath(), "{ not json !!", "utf-8");
    expect(() => readLock()).toThrow(LockFileError);
    try {
      readLock();
    } catch (err) {
      expect(String(err)).toMatch(/malformed/);
      expect(String(err)).toMatch(/repair/i);
      expect(String(err)).toMatch(/refuse-to-run/);
    }
    rmSync(getLockPath(), { force: true });
  });

  test("a lock without a hooks map throws LockFileError", () => {
    writeFileSync(getLockPath(), JSON.stringify({ something: "else" }), "utf-8");
    expect(() => readLock()).toThrow(/malformed/);
    rmSync(getLockPath(), { force: true });
  });

  test("a lock with a malformed entry throws LockFileError", () => {
    writeFileSync(getLockPath(), JSON.stringify({ hooks: { gitguard: { version: "1.0.0" } } }), "utf-8");
    expect(() => readLock()).toThrow(/entry for 'gitguard'/);
    rmSync(getLockPath(), { force: true });
  });

  test("a malformed lock refuses to be overwritten by setPinnedHook (no silent re-trust)", () => {
    writeFileSync(getLockPath(), "garbage", "utf-8");
    expect(() => setPinnedHook("gitguard", { version: "1.0.0", sha256: "a".repeat(64), source: "bundled" }))
      .toThrow(LockFileError);
    // The garbage is still on disk: the fail-open overwrite must NOT have
    // happened.
    expect(readFileSync(getLockPath(), "utf-8")).toBe("garbage");
    rmSync(getLockPath(), { force: true });
  });
});

describe("lock atomic write (P1-9)", () => {
  test("writeLock never leaves a temp file behind", () => {
    writeLock({ hooks: { alpha: { version: "1.0.0", sha256: "a", source: "bundled" } } });
    const dir = join(TEST_DIR, "..");
    const lockDir = dirnameSafe(getLockPath());
    const leftovers = readdirSync(lockDir).filter((f) => f.includes(".tmp-"));
    expect(leftovers).toHaveLength(0);
    expect(readLock().hooks.alpha).toEqual({ version: "1.0.0", sha256: "a", source: "bundled" });
    expect(getPinnedHook("alpha")).toEqual({ version: "1.0.0", sha256: "a", source: "bundled" });
  });
});

function dirnameSafe(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : ".";
}
