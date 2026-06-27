import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, join, relative, resolve, sep } from "path";
import { spawnSync } from "child_process";

export interface DiscoveredDatabase {
  path: string;
  size: number;
}

export interface DbIntegrityCheckOptions {
  roots?: string[];
  maxDbs?: number;
  maxSizeBytes?: number;
  reportPath?: string;
}

export interface DbIntegrityCheckResult {
  version: 1;
  checked_at: string;
  roots: string[];
  limits: {
    max_dbs: number;
    max_size_bytes: number;
  };
  summary: {
    discovered: number;
    checked: number;
    ok: number;
    failed: number;
    skipped: number;
    truncated: boolean;
  };
  databases: Array<{
    path: string;
    size: number;
    status: "ok" | "failed" | "skipped";
    detail: string;
  }>;
  report_path?: string;
}

export interface OpsSnapshotOptions {
  roots?: string[];
  snapshotDir?: string;
  maxDbs?: number;
  maxSizeBytes?: number;
  keepDays?: number;
  keepBatches?: number;
  dryRun?: boolean;
  reportPath?: string;
}

export interface OpsSnapshotResult {
  version: 1;
  snapshot_at: string;
  roots: string[];
  snapshot_dir: string;
  batch_dir: string;
  dry_run: boolean;
  limits: {
    max_dbs: number;
    max_size_bytes: number;
    keep_days: number;
    keep_batches: number;
  };
  summary: {
    discovered: number;
    copied: number;
    skipped: number;
    failed: number;
    truncated: boolean;
    pruned_batches: number;
  };
  snapshots: Array<{
    source: string;
    destination?: string;
    size: number;
    status: "copied" | "failed" | "skipped";
    detail: string;
  }>;
  report_path?: string;
}

const DEFAULT_MAX_DBS = 200;
const DEFAULT_MAX_SIZE_BYTES = 512 * 1024 * 1024;
const DEFAULT_KEEP_DAYS = 7;
const DEFAULT_KEEP_BATCHES = 20;

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "cache",
  "reports",
  "snapshots",
  "quarantine",
  "tmp",
  "temp",
]);

const DB_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const SENSITIVE_DB_PATH_MARKERS = [
  `${sep}.hasna${sep}secrets${sep}`,
  `${sep}.secrets${sep}`,
  `${sep}.config${sep}`,
  `${sep}.ssh${sep}`,
  `${sep}.codewith${sep}`,
  `${sep}connectors${sep}`,
  `${sep}.hasna${sep}connectors${sep}`,
  `${sep}.hasna${sep}accounts${sep}`,
  `${sep}.hasna${sep}auth${sep}`,
];

export function runDbIntegrityCheck(options: DbIntegrityCheckOptions = {}): DbIntegrityCheckResult {
  const roots = normalizeRoots(options.roots);
  const maxDbs = normalizePositiveInteger(options.maxDbs, DEFAULT_MAX_DBS);
  const maxSizeBytes = normalizePositiveInteger(options.maxSizeBytes, DEFAULT_MAX_SIZE_BYTES);
  const discovered = discoverSqliteDatabases(roots, { maxDbs, maxSizeBytes });
  const databases: DbIntegrityCheckResult["databases"] = [];

  for (const db of discovered.databases) {
    if (db.size > maxSizeBytes) {
      databases.push({ path: db.path, size: db.size, status: "skipped", detail: "larger than max_size_bytes" });
      continue;
    }
    databases.push(checkDatabase(db));
  }

  const result: DbIntegrityCheckResult = {
    version: 1,
    checked_at: new Date().toISOString(),
    roots,
    limits: { max_dbs: maxDbs, max_size_bytes: maxSizeBytes },
    summary: {
      discovered: discovered.total,
      checked: databases.filter((db) => db.status !== "skipped").length,
      ok: databases.filter((db) => db.status === "ok").length,
      failed: databases.filter((db) => db.status === "failed").length,
      skipped: databases.filter((db) => db.status === "skipped").length,
      truncated: discovered.truncated,
    },
    databases,
  };

  if (options.reportPath) {
    result.report_path = writeJsonReport(options.reportPath, result);
  }
  return result;
}

export function runOpsStateSnapshot(options: OpsSnapshotOptions = {}): OpsSnapshotResult {
  const roots = normalizeSnapshotRoots(options.roots);
  const maxDbs = normalizePositiveInteger(options.maxDbs, DEFAULT_MAX_DBS);
  const maxSizeBytes = normalizePositiveInteger(options.maxSizeBytes, DEFAULT_MAX_SIZE_BYTES);
  const keepDays = normalizePositiveInteger(options.keepDays, DEFAULT_KEEP_DAYS);
  const keepBatches = normalizePositiveInteger(options.keepBatches, DEFAULT_KEEP_BATCHES);
  const snapshotDir = normalizeSnapshotDir(options.snapshotDir);
  const snapshotAt = new Date().toISOString();
  const batchName = snapshotAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const batchDir = join(snapshotDir, batchName);
  const dryRun = Boolean(options.dryRun);
  const discovered = discoverSqliteDatabases(roots, { maxDbs, maxSizeBytes, excludeSensitive: true });
  const snapshots: OpsSnapshotResult["snapshots"] = [];

  if (!dryRun) {
    mkdirPrivateDir(snapshotDir);
    mkdirPrivateDir(batchDir);
  }

  for (const db of discovered.databases) {
    if (db.size > maxSizeBytes) {
      snapshots.push({ source: db.path, size: db.size, status: "skipped", detail: "larger than max_size_bytes" });
      continue;
    }
    const destination = join(batchDir, safeRelativeSnapshotPath(db.path));
    if (dryRun) {
      snapshots.push({ source: db.path, destination, size: db.size, status: "skipped", detail: "dry run" });
      continue;
    }
    snapshots.push(copyDatabaseSnapshot(db, destination));
  }

  const prunedBatches = dryRun ? 0 : pruneSnapshotBatches(snapshotDir, { keepDays, keepBatches, preserve: batchName });

  const result: OpsSnapshotResult = {
    version: 1,
    snapshot_at: snapshotAt,
    roots,
    snapshot_dir: snapshotDir,
    batch_dir: batchDir,
    dry_run: dryRun,
    limits: {
      max_dbs: maxDbs,
      max_size_bytes: maxSizeBytes,
      keep_days: keepDays,
      keep_batches: keepBatches,
    },
    summary: {
      discovered: discovered.total,
      copied: snapshots.filter((entry) => entry.status === "copied").length,
      skipped: snapshots.filter((entry) => entry.status === "skipped").length,
      failed: snapshots.filter((entry) => entry.status === "failed").length,
      truncated: discovered.truncated,
      pruned_batches: prunedBatches,
    },
    snapshots,
  };

  if (options.reportPath) {
    result.report_path = writeJsonReport(options.reportPath, result);
  }
  return result;
}

function normalizeRoots(roots?: string[]): string[] {
  const selected = roots && roots.length > 0
    ? roots
    : [join(homedir(), ".hasna"), join(homedir(), ".codewith")];
  return [...new Set(selected.map((root) => resolve(root)))];
}

function normalizeSnapshotRoots(roots?: string[]): string[] {
  if (roots && roots.length > 0) return [...new Set(roots.map((root) => resolve(root)))];
  return [
    join(homedir(), ".hasna", "files"),
    join(homedir(), ".hasna", "todos"),
    join(homedir(), ".hasna", "loops"),
    join(homedir(), ".hasna", "repos"),
    join(homedir(), ".hasna", "economy"),
    join(homedir(), ".hasna", "knowledge"),
    join(homedir(), ".hasna", "notes"),
  ].map((root) => resolve(root));
}

function normalizeSnapshotDir(path?: string): string {
  const root = resolve(defaultSnapshotRoot());
  const selected = resolve(path ?? root);
  if (selected !== root && !selected.startsWith(`${root}${sep}`)) {
    throw new Error(`Refusing snapshot-dir outside managed root: ${selected}. Use ${root} or a child directory.`);
  }
  return selected;
}

function defaultSnapshotRoot(): string {
  if (process.env["HASNA_FILES_OPS_SNAPSHOT_ROOT"]) return process.env["HASNA_FILES_OPS_SNAPSHOT_ROOT"];
  return join(homedir(), ".hasna", "files", "snapshots", "ops-state");
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function discoverSqliteDatabases(
  roots: string[],
  limits: { maxDbs: number; maxSizeBytes: number; excludeSensitive?: boolean },
): { databases: DiscoveredDatabase[]; total: number; truncated: boolean } {
  const databases: DiscoveredDatabase[] = [];
  let total = 0;
  let truncated = false;

  for (const root of roots) {
    if (!existsSync(root)) continue;
    walk(root, (path, size) => {
      if (limits.excludeSensitive && isSensitiveDatabasePath(path)) return true;
      total += 1;
      if (databases.length >= limits.maxDbs) {
        truncated = true;
        return false;
      }
      databases.push({ path, size });
      return true;
    });
    if (databases.length >= limits.maxDbs) truncated = true;
  }

  return { databases, total, truncated };
}

function walk(root: string, onDatabase: (path: string, size: number) => boolean): boolean {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return true;
  }

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name, path)) continue;
      if (!walk(path, onDatabase)) return false;
      continue;
    }
    if (!entry.isFile() || !looksLikeSqlitePath(entry.name)) continue;
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    if (!onDatabase(path, size)) return false;
  }

  return true;
}

function shouldSkipDirectory(name: string, path: string): boolean {
  if (SKIP_DIR_NAMES.has(name)) return true;
  const normalized = `${sep}${path}${sep}`;
  return normalized.includes(`${sep}.hasna${sep}loops${sep}cache${sep}`)
    || normalized.includes(`${sep}.hasna${sep}loops${sep}reports${sep}`)
    || normalized.includes(`${sep}.hasna${sep}loops${sep}snapshots${sep}`)
    || normalized.includes(`${sep}.hasna${sep}loops${sep}quarantine${sep}`);
}

function isSensitiveDatabasePath(path: string): boolean {
  const normalized = `${sep}${resolve(path)}${sep}`;
  if (SENSITIVE_DB_PATH_MARKERS.some((marker) => normalized.includes(marker))) return true;
  const lower = path.toLowerCase();
  return lower.endsWith(`${sep}vault.db`)
    || lower.includes(`${sep}secrets`)
    || lower.includes(`${sep}token`)
    || lower.includes(`${sep}credential`)
    || lower.includes(`${sep}auth`);
}

function looksLikeSqlitePath(name: string): boolean {
  const lower = name.toLowerCase();
  for (const extension of DB_EXTENSIONS) {
    if (lower.endsWith(extension)) return true;
  }
  return false;
}

function checkDatabase(db: DiscoveredDatabase): DbIntegrityCheckResult["databases"][number] {
  let database: Database | undefined;
  try {
    database = new Database(db.path, { readonly: true });
    const rows = database.query<Record<string, string>, []>("PRAGMA quick_check").all();
    const detail = Object.values(rows[0] ?? {})[0] ?? "";
    const ok = detail.toLowerCase() === "ok";
    return {
      path: db.path,
      size: db.size,
      status: ok ? "ok" : "failed",
      detail: detail || "quick_check returned no rows",
    };
  } catch (error) {
    return {
      path: db.path,
      size: db.size,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    database?.close();
  }
}

function safeRelativeSnapshotPath(path: string): string {
  const home = homedir();
  const rel = path.startsWith(home) ? relative(home, path) : path.replace(/^\/+/, "");
  return rel.split(sep).filter(Boolean).join("__");
}

function copyDatabaseSnapshot(db: DiscoveredDatabase, destination: string): OpsSnapshotResult["snapshots"][number] {
  mkdirPrivateDir(dirname(destination));
  const sqlite3 = spawnSync("sqlite3", ["--version"], { encoding: "utf8" });
  if (sqlite3.status === 0) {
    const result = spawnSync(
      "sqlite3",
      [db.path, ".timeout 1000", `.backup '${destination.replace(/'/g, "''")}'`],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      chmodPrivateFile(destination);
      return { source: db.path, destination, size: db.size, status: "copied", detail: "sqlite backup" };
    }
    return {
      source: db.path,
      destination,
      size: db.size,
      status: "failed",
      detail: (result.stderr || result.stdout || "sqlite backup failed").trim(),
    };
  }

  try {
    copyFileSync(db.path, destination);
    chmodPrivateFile(destination);
    return { source: db.path, destination, size: db.size, status: "copied", detail: "file copy" };
  } catch (error) {
    return {
      source: db.path,
      destination,
      size: db.size,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function pruneSnapshotBatches(
  snapshotDir: string,
  opts: { keepDays: number; keepBatches: number; preserve: string },
): number {
  const normalizedSnapshotDir = normalizeSnapshotDir(snapshotDir);
  if (normalizedSnapshotDir !== snapshotDir) return pruneSnapshotBatches(normalizedSnapshotDir, opts);
  if (!existsSync(snapshotDir)) return 0;
  const cutoff = Date.now() - opts.keepDays * 24 * 60 * 60 * 1000;
  const batches = readdirSync(snapshotDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(snapshotDir, entry.name);
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(path).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { name: entry.name, path, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  let pruned = 0;
  for (const [index, batch] of batches.entries()) {
    if (batch.name === opts.preserve) continue;
    if (index < opts.keepBatches && batch.mtimeMs >= cutoff) continue;
    if (!batch.path.startsWith(`${snapshotDir}${sep}`)) continue;
    rmSync(batch.path, { recursive: true, force: true });
    pruned += 1;
  }
  return pruned;
}

function writeJsonReport(path: string, value: unknown): string {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`);
  return resolved;
}

function mkdirPrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
}

function chmodPrivateFile(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
}
