import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { dbPath } from "./paths.js";

const DEFAULT_KEEP = 3;
const DEBOUNCE_MS = 60 * 60 * 1000;

export interface BackupDatabaseOptions {
  /** Why this backup is being taken (e.g. "pre-migration", "daily"). Debounce and retention are tracked per reason. */
  reason: string;
  /** How many backups to retain per reason (newest first). */
  keep?: number;
  /** Source database file; defaults to the live store path. Tests must pass a temp path. */
  dbFile?: string;
  /** Directory for backup files; defaults to `<db dir>/backups`. */
  backupsDir?: string;
  /** Injectable clock for tests. */
  now?: Date;
  /** Bypass the per-reason debounce and always write a backup. */
  force?: boolean;
}

export interface BackupDatabaseResult {
  /** Absolute path of the backup that was written (absent when skipped). */
  path?: string;
  skipped: boolean;
  skipReason?: string;
  /** Backups removed by retention pruning. */
  prunedPaths: string[];
}

function reasonSlug(reason: string): string {
  const slug = reason
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "backup";
}

function backupStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/** Parse the timestamp back out of `loops-<slug>-<stamp>.db`; returns NaN when unparseable. */
function parseBackupTime(fileName: string, slug: string): number {
  const prefix = `loops-${slug}-`;
  if (!fileName.startsWith(prefix) || !fileName.endsWith(".db")) return Number.NaN;
  const stamp = fileName.slice(prefix.length, -".db".length);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(stamp);
  if (!match) return Number.NaN;
  return Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
}

function listBackups(dir: string, slug: string): Array<{ name: string; timeMs: number }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, timeMs: parseBackupTime(name, slug) }))
    .filter((entry) => Number.isFinite(entry.timeMs))
    .sort((a, b) => b.timeMs - a.timeMs);
}

/**
 * Snapshot the loops database with `VACUUM INTO`. Per-reason backups are
 * debounced to at most one per hour and pruned to the `keep` most recent.
 */
export function backupDatabase(opts: BackupDatabaseOptions): BackupDatabaseResult {
  const keep = Math.max(1, opts.keep ?? DEFAULT_KEEP);
  const file = opts.dbFile ?? dbPath();
  if (!existsSync(file)) {
    return { skipped: true, skipReason: `database file not found: ${file}`, prunedPaths: [] };
  }
  const dir = opts.backupsDir ?? join(dirname(file), "backups");
  const slug = reasonSlug(opts.reason);
  const now = opts.now ?? new Date();
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const existing = listBackups(dir, slug);
  const newest = existing[0];
  if (!opts.force && newest && now.getTime() - newest.timeMs < DEBOUNCE_MS) {
    return {
      skipped: true,
      skipReason: `backup for reason "${opts.reason}" already taken within the last hour`,
      prunedPaths: [],
    };
  }

  const target = join(dir, `loops-${slug}-${backupStamp(now)}.db`);
  const db = new Database(file, { readonly: true });
  try {
    db.query("VACUUM INTO ?").run(target);
  } catch (error) {
    rmSync(target, { force: true });
    throw error;
  } finally {
    db.close();
  }
  chmodSync(target, 0o600);

  const prunedPaths: string[] = [];
  for (const entry of listBackups(dir, slug).slice(keep)) {
    const path = join(dir, entry.name);
    rmSync(path, { force: true });
    prunedPaths.push(path);
  }
  return { path: target, skipped: false, prunedPaths };
}
