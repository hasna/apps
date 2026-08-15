/**
 * Hook store — SQLite hooks table + hooks.lock pin file.
 *
 * The DB record and the lock pin are written together so a verified hash is
 * never trusted on one surface only. The lock file is the portable pin that a
 * remote registry sync compares against.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { readFile } from "fs/promises";
import type { Database } from "bun:sqlite";
import { getDb } from "../db/index.js";
import { getLockPath } from "../config.js";
import { randomBytes } from "crypto";

export interface HookRecord {
  id: string;
  name: string;
  version: string;
  sha256: string;
  source_type: string;
  source_ref: string | null;
  installed_at: string;
  enabled: number;
  last_verified_at: string | null;
}

export interface LockEntry {
  version: string;
  sha256: string;
  source: string;
  /**
   * True when the pin came from an explicit `hooks install/update
   * <name>@<version>` (P2-9): an explicit older pin is preserved across
   * syncs instead of being silently bumped to the latest. Absent/undefined
   * pins are ordinary sync-maintained pins and follow the latest.
   */
  pinned?: boolean;
}

export interface LockFile {
  hooks: Record<string, LockEntry>;
}

export function sha256Of(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return sha256Of(buf);
}

export function getHookRecord(db: Database, name: string): HookRecord | null {
  return db.query<HookRecord, [string]>("SELECT * FROM hooks WHERE name = ?").get(name);
}

export function listHookRecords(db: Database): HookRecord[] {
  return db.query<HookRecord, []>("SELECT * FROM hooks ORDER BY name").all();
}

export function upsertHookRecord(
  db: Database,
  record: {
    name: string;
    version: string;
    sha256: string;
    source_type: string;
    source_ref?: string | null;
    enabled?: number;
    last_verified_at?: string | null;
  },
): void {
  const existing = getHookRecord(db, record.name);
  const id = existing?.id ?? record.name;
  const installedAt = existing?.installed_at ?? new Date().toISOString();
  const enabled = record.enabled ?? existing?.enabled ?? 1;
  db.run(
    `INSERT INTO hooks (id, name, version, sha256, source_type, source_ref, installed_at, enabled, last_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       version = excluded.version,
       sha256 = excluded.sha256,
       source_type = excluded.source_type,
       source_ref = excluded.source_ref,
       enabled = excluded.enabled,
       last_verified_at = excluded.last_verified_at`,
    [
      id,
      record.name,
      record.version,
      record.sha256,
      record.source_type,
      record.source_ref ?? existing?.source_ref ?? null,
      installedAt,
      enabled,
      record.last_verified_at ?? null,
    ],
  );
}

export function removeHookRecord(db: Database, name: string): boolean {
  const res = db.run("DELETE FROM hooks WHERE name = ?", [name]);
  return res.changes > 0;
}

/**
 * Raised when hooks.lock is present but malformed. P1-9: a malformed lock
 * used to degrade to {hooks:{}} — a fail-open that would let the next sync
 * re-trust hooks as if nothing had been pinned. It now fails hard with a
 * repair message; no execution path treats a broken lock as an empty store.
 */
export class LockFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockFileError";
  }
}

function assertLockShape(parsed: unknown, path: string): asserts parsed is LockFile {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LockFileError(
      `hooks.lock (${path}) is malformed: expected a JSON object with a "hooks" map. ` +
        `Repair: fix the file by hand, or if it is unrecoverable move it aside and run 'hooks sync' to rebuild it. ` +
        `Nothing was trusted or rewritten — hooks are left in the refuse-to-run state until the lock is repaired.`,
    );
  }
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new LockFileError(
      `hooks.lock (${path}) is malformed: missing or invalid "hooks" map. ` +
        `Repair: fix the file by hand, or if it is unrecoverable move it aside and run 'hooks sync' to rebuild it. ` +
        `Nothing was trusted or rewritten — hooks are left in the refuse-to-run state until the lock is repaired.`,
    );
  }
  for (const [name, entry] of Object.entries(hooks as Record<string, unknown>)) {
    const e = entry as { version?: unknown; sha256?: unknown };
    if (e === null || typeof e !== "object" || typeof e.version !== "string" || typeof e.sha256 !== "string") {
      throw new LockFileError(
        `hooks.lock (${path}) is malformed: entry for '${name}' is not a valid pin (version and sha256 strings required). ` +
          `Repair: fix the file by hand, or if it is unrecoverable move it aside and run 'hooks sync' to rebuild it.`,
      );
    }
  }
}

export function readLock(): LockFile {
  const path = getLockPath();
  if (!existsSync(path)) return { hooks: {} };
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new LockFileError(
      `hooks.lock (${path}) could not be read. Repair: fix permissions or move the file aside and run 'hooks sync'.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LockFileError(
      `hooks.lock (${path}) is malformed: not valid JSON (${String((raw ?? "").slice(0, 80))}). ` +
        `Repair: fix the file by hand, or if it is unrecoverable move it aside and run 'hooks sync' to rebuild it. ` +
        `Nothing was trusted or rewritten — hooks are left in the refuse-to-run state until the lock is repaired.`,
    );
  }
  assertLockShape(parsed, path);
  return parsed;
}

export function writeLock(lock: LockFile): string {
  const path = getLockPath();
  mkdirSync(path.substring(0, path.lastIndexOf("/")) || ".", { recursive: true });
  const sorted: Record<string, LockEntry> = {};
  for (const name of Object.keys(lock.hooks).sort()) {
    sorted[name] = lock.hooks[name];
  }
  // P1-9 atomic write: serialize to a temp file in the same directory, then
  // rename over the target, so a crash or kill mid-write can never leave a
  // truncated lock (which would read as malformed on the next read).
  const tmp = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  writeFileSync(tmp, JSON.stringify({ hooks: sorted }, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
  return path;
}

export function setPinnedHook(name: string, entry: LockEntry): string {
  const lock = readLock();
  lock.hooks[name] = entry;
  return writeLock(lock);
}

export function getPinnedHook(name: string): LockEntry | undefined {
  return readLock().hooks[name];
}

export function removePinnedHook(name: string): boolean {
  const lock = readLock();
  if (!(name in lock.hooks)) return false;
  delete lock.hooks[name];
  writeLock(lock);
  return true;
}

/**
 * Pin a hook at install time — the ACTUAL installed version and sha, so the
 * first run is trusted with real provenance instead of a 0.0.0 placeholder
 * (QA-1 P3: install pinned 0.0.0 until trust).
 */
export function pinInstalledHook(
  name: string,
  version: string,
  sha256: string,
  source: string,
  sourceRef?: string | null,
): void {
  const now = new Date().toISOString();
  const db = getDb();
  upsertHookRecord(db, {
    name,
    version,
    sha256,
    source_type: source,
    source_ref: sourceRef ?? null,
    last_verified_at: now,
  });
  setPinnedHook(name, { version, sha256, source });
}

/**
 * Remove every store-side record of a hook: the lock pin and the DB row.
 * Does not touch hook files on disk — callers decide whether the hook lives
 * in the package (bundled, keep) or the custom store dir (remove).
 */
export function removeHookFromStore(name: string): { removedPin: boolean; removedRecord: boolean } {
  const removedPin = removePinnedHook(name);
  const db = getDb();
  const removedRecord = removeHookRecord(db, name);
  return { removedPin, removedRecord };
}

export interface TrustCheck {
  ok: boolean;
  pinned: boolean;
  expected: string | null;
  actual: string;
  name: string;
}

/**
 * Check a hook script's content hash against the trusted record.
 * No record exists (first run) => pin the current hash and pass.
 * Record or pin exists and differs => refuse.
 *
 * Takes a precomputed hash so callers can verify the exact bytes they are
 * about to execute (content-based verification), instead of re-reading a path.
 */
export function checkScriptHash(name: string, actual: string): TrustCheck {
  const db = getDb();
  const record = getHookRecord(db, name);
  const pin = getPinnedHook(name);
  const expected = record?.sha256 ?? pin?.sha256 ?? null;
  if (expected !== null && expected !== actual) {
    return { ok: false, pinned: true, expected, actual, name };
  }
  if (expected === null) {
    const now = new Date().toISOString();
    const version = pin?.version ?? record?.version ?? "0.0.0";
    const source = pin?.source ?? record?.source_type ?? "local";
    upsertHookRecord(db, {
      name,
      version,
      sha256: actual,
      source_type: source,
      last_verified_at: now,
    });
    setPinnedHook(name, { version, sha256: actual, source });
    return { ok: true, pinned: false, expected: null, actual, name };
  }
  const now = new Date().toISOString();
  upsertHookRecord(db, {
    name,
    version: record?.version ?? pin?.version ?? "0.0.0",
    sha256: expected,
    source_type: record?.source_type ?? pin?.source ?? "local",
    last_verified_at: now,
  });
  return { ok: true, pinned: true, expected, actual, name };
}

/**
 * Verify a hook script's content hash against the trusted record, reading the
 * script from disk. Execution paths should prefer checkScriptHash with the
 * bytes they already hold so the verified bytes are the executed bytes.
 */
export async function verifyScriptHash(name: string, scriptPath: string): Promise<TrustCheck> {
  return checkScriptHash(name, await sha256File(scriptPath));
}

export function retrustHook(name: string, scriptPath: string, version: string, source: string): TrustCheck {
  const actual = sha256Of(readFileSync(scriptPath));
  const db = getDb();
  upsertHookRecord(db, {
    name,
    version,
    sha256: actual,
    source_type: source,
    last_verified_at: new Date().toISOString(),
  });
  setPinnedHook(name, { version, sha256: actual, source });
  return { ok: true, pinned: true, expected: actual, actual, name };
}
