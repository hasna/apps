#!/usr/bin/env bun
/**
 * Detached, one-use SQLite upgrader to todos.sqlite.v68.
 *
 * Deliberately not exported, bundled, registered as a bin, or reachable from a
 * production dynamic import. Invoke this source file directly during the v68
 * cutover support window, then remove the whole directory when that window ends.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import {
  calculateCurrentSchemaHash,
  CURRENT_SCHEMA_HASH,
  CURRENT_SCHEMA_ID,
  CURRENT_SCHEMA_VERSION,
  inspectLocalSchema,
} from "../../../src/db/current-schema.js";
import { ensureAgentIdentitySchema } from "../../../src/db/identity-mapping.js";
import { backfillMachineId } from "../../../src/db/machines.js";
import { backfillTaskTags, runMigrations } from "../../../src/db/schema.js";

const EVIDENCE_SCHEMA = "todos.detached_schema_upgrade.v1" as const;
const FTS_SHADOW_TABLES = new Set([
  "tasks_fts_data",
  "tasks_fts_idx",
  "tasks_fts_content",
  "tasks_fts_docsize",
  "tasks_fts_config",
]);

interface TableEvidence {
  rows: number;
  sha256: string;
}

interface StoreEvidence {
  tables: Record<string, TableEvidence>;
  total_rows: number;
  sha256: string;
}

interface IntegrityEvidence {
  quick_check: string;
  foreign_key_violations: number;
}

interface Checkpoint {
  name: string;
  at: string;
  details?: Record<string, unknown>;
}

interface UpgradeEvidence {
  evidence_schema: typeof EVIDENCE_SCHEMA;
  upgrade_id: string;
  status: "in_progress" | "complete" | "failed" | "already_current";
  source_path: string;
  source_schema: { kind: "historical"; migration_level: number } | { kind: "current" };
  target_schema: { id: typeof CURRENT_SCHEMA_ID; version: typeof CURRENT_SCHEMA_VERSION; sha256: typeof CURRENT_SCHEMA_HASH };
  backup: {
    path: string;
    bytes?: number;
    sha256?: string;
    integrity?: IntegrityEvidence;
    verified: boolean;
  };
  recovery: {
    original_path: string;
    original_wal_path: string | null;
    original_shm_path: string | null;
    instructions: string[];
  };
  before?: StoreEvidence;
  after?: StoreEvidence;
  checkpoints: Checkpoint[];
  started_at: string;
  completed_at?: string;
  error?: string;
}

export interface UpgradeOptions {
  database: string;
  backup?: string;
  evidence?: string;
  now?: () => Date;
}

export interface UpgradeResult {
  status: "complete" | "already_current";
  evidence_path: string;
  backup_path: string | null;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(path: string): string {
  return hashBytes(readFileSync(path));
}

function syncFile(path: string): void {
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function atomicWriteJson(path: string, value: unknown, initial = false): void {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (initial) {
    writeFileSync(path, content, { flag: "wx", mode: 0o600 });
    syncFile(path);
    return;
  }
  const staging = `${path}.tmp`;
  writeFileSync(staging, content, { flag: "w", mode: 0o600 });
  syncFile(staging);
  renameSync(staging, path);
}

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Uint8Array) return `bytes:${Buffer.from(value).toString("base64")}`;
  switch (typeof value) {
    case "string": return `string:${value}`;
    case "number": return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
    case "bigint": return `bigint:${value}`;
    default: return `${typeof value}:${JSON.stringify(value)}`;
  }
}

function snapshotStore(db: Database): StoreEvidence {
  const tables = (db.query(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((name) => name !== "_migrations"
      && name !== "_todos_schema"
      && !name.startsWith("shadow_")
      && !FTS_SHADOW_TABLES.has(name));

  const result: Record<string, TableEvidence> = {};
  let totalRows = 0;
  for (const table of tables) {
    const columns = db.query(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{
      name: string;
      pk: number;
    }>;
    const names = columns.map((column) => column.name);
    const statement = db.query(`SELECT * FROM ${quoteIdentifier(table)}`);
    const rowHashes: string[] = [];
    for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
      const encoded = names.map((name) => `${name}=${canonicalValue(row[name])}`).join("\0");
      rowHashes.push(createHash("sha256").update(encoded).digest("hex"));
    }
    rowHashes.sort();
    const digest = createHash("sha256");
    for (const rowHash of rowHashes) digest.update(rowHash).update("\n");
    result[table] = { rows: rowHashes.length, sha256: digest.digest("hex") };
    totalRows += rowHashes.length;
  }

  const overall = createHash("sha256");
  for (const [table, evidence] of Object.entries(result)) {
    overall.update(table).update("\0").update(String(evidence.rows)).update("\0").update(evidence.sha256).update("\n");
  }
  return { tables: result, total_rows: totalRows, sha256: overall.digest("hex") };
}

function checkIntegrity(db: Database): IntegrityEvidence {
  const quickCheck = (db.query("PRAGMA quick_check").get() as { quick_check: string }).quick_check;
  const foreignKeys = db.query("PRAGMA foreign_key_check").all();
  return { quick_check: quickCheck, foreign_key_violations: foreignKeys.length };
}

function assertIntegrity(integrity: IntegrityEvidence, label: string): void {
  if (integrity.quick_check !== "ok" || integrity.foreign_key_violations !== 0) {
    throw new Error(
      `${label} integrity failed: quick_check=${integrity.quick_check}, foreign_key_violations=${integrity.foreign_key_violations}`,
    );
  }
}

function checkpoint(
  evidencePath: string,
  evidence: UpgradeEvidence,
  name: string,
  now: () => Date,
  details?: Record<string, unknown>,
): void {
  evidence.checkpoints.push({ name, at: now().toISOString(), details });
  atomicWriteJson(evidencePath, evidence);
}

function assertDistinctPaths(paths: Record<string, string>): void {
  const seen = new Map<string, string>();
  for (const [label, path] of Object.entries(paths)) {
    const previous = seen.get(path);
    if (previous) throw new Error(`${label} path must differ from ${previous} path: ${path}`);
    seen.set(path, label);
  }
}

function markCurrent(db: Database, installedAt: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DELETE FROM _migrations;
      INSERT INTO _migrations (id) VALUES (${CURRENT_SCHEMA_VERSION});
      DROP TABLE IF EXISTS _todos_schema;
      CREATE TABLE _todos_schema (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        schema_id TEXT NOT NULL,
        schema_hash TEXT NOT NULL,
        installed_at TEXT NOT NULL
      );
    `);
    db.query(`
      INSERT INTO _todos_schema (singleton, schema_id, schema_hash, installed_at)
      VALUES (1, ?, ?, ?)
    `).run(CURRENT_SCHEMA_ID, CURRENT_SCHEMA_HASH, installedAt);
    db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* transaction did not start */ }
    throw error;
  }
}

function moveIfPresent(from: string, to: string): string | null {
  if (!existsSync(from)) return null;
  if (existsSync(to)) throw new Error(`Recovery path already exists: ${to}`);
  renameSync(from, to);
  return to;
}

function defaultPaths(source: string, stamp: string): { backup: string; evidence: string; work: string; original: string } {
  const suffix = stamp.replaceAll(":", "-").replaceAll(".", "-");
  const base = `${basename(source)}.pre-${CURRENT_SCHEMA_ID}.${suffix}`;
  return {
    backup: resolve(dirname(source), `${base}.backup.db`),
    evidence: resolve(dirname(source), `${base}.evidence.json`),
    work: resolve(dirname(source), `${base}.working.db`),
    original: resolve(dirname(source), `${base}.original.db`),
  };
}

export function upgradeDatabase(options: UpgradeOptions): UpgradeResult {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const source = resolve(options.database);
  if (!existsSync(source)) throw new Error(`Database not found: ${source}`);
  const defaults = defaultPaths(source, startedAt);
  const backupPath = resolve(options.backup ?? defaults.backup);
  const evidencePath = resolve(options.evidence ?? defaults.evidence);
  const workPath = defaults.work;
  const originalPath = defaults.original;
  const originalWalPath = `${originalPath}-wal`;
  const originalShmPath = `${originalPath}-shm`;
  assertDistinctPaths({ database: source, backup: backupPath, evidence: evidencePath, work: workPath, original: originalPath });

  if (existsSync(evidencePath)) throw new Error(`Evidence path already exists: ${evidencePath}`);
  const sourceDb = new Database(source);
  sourceDb.run("PRAGMA busy_timeout = 1000");
  sourceDb.run("PRAGMA foreign_keys = ON");

  const state = inspectLocalSchema(sourceDb);
  if (state.kind === "empty") {
    sourceDb.close();
    throw new Error("Refusing empty database; the normal runtime creates the current schema directly");
  }
  if (state.kind === "ambiguous") {
    sourceDb.close();
    throw new Error(`Refusing ambiguous source state: ${state.reason}`);
  }
  if (state.kind === "current") {
    const evidence: UpgradeEvidence = {
      evidence_schema: EVIDENCE_SCHEMA,
      upgrade_id: crypto.randomUUID(),
      status: "already_current",
      source_path: source,
      source_schema: { kind: "current" },
      target_schema: { id: CURRENT_SCHEMA_ID, version: CURRENT_SCHEMA_VERSION, sha256: CURRENT_SCHEMA_HASH },
      backup: { path: backupPath, verified: false },
      recovery: {
        original_path: source,
        original_wal_path: null,
        original_shm_path: null,
        instructions: ["No recovery action is needed; this run made no database changes."],
      },
      before: snapshotStore(sourceDb),
      after: snapshotStore(sourceDb),
      checkpoints: [{ name: "already_current_verified", at: now().toISOString() }],
      started_at: startedAt,
      completed_at: now().toISOString(),
    };
    sourceDb.close();
    atomicWriteJson(evidencePath, evidence, true);
    return { status: "already_current", evidence_path: evidencePath, backup_path: null };
  }

  const evidence: UpgradeEvidence = {
    evidence_schema: EVIDENCE_SCHEMA,
    upgrade_id: crypto.randomUUID(),
    status: "in_progress",
    source_path: source,
    source_schema: { kind: "historical", migration_level: state.migration_level },
    target_schema: { id: CURRENT_SCHEMA_ID, version: CURRENT_SCHEMA_VERSION, sha256: CURRENT_SCHEMA_HASH },
    backup: { path: backupPath, verified: false },
    recovery: {
      original_path: originalPath,
      original_wal_path: null,
      original_shm_path: null,
      instructions: [
        `Stop all todos processes.`,
        `Verify the backup SHA-256 recorded in ${evidencePath}.`,
        `Restore ${backupPath} over ${source}.`,
        `Remove ${source}-wal and ${source}-shm only after the replacement is complete.`,
      ],
    },
    checkpoints: [],
    started_at: startedAt,
  };
  atomicWriteJson(evidencePath, evidence, true);

  let sourceLocked = false;
  let workDb: Database | null = null;
  try {
    try {
      sourceDb.exec("BEGIN EXCLUSIVE");
      sourceLocked = true;
    } catch (error) {
      throw new Error(`Database is not offline or cannot be locked exclusively: ${error instanceof Error ? error.message : String(error)}`);
    }

    const sourceIntegrity = checkIntegrity(sourceDb);
    assertIntegrity(sourceIntegrity, "source");
    evidence.before = snapshotStore(sourceDb);
    checkpoint(evidencePath, evidence, "source_verified_and_locked", now, {
      migration_level: state.migration_level,
      data_sha256: evidence.before.sha256,
      total_rows: evidence.before.total_rows,
    });

    if (existsSync(backupPath)) throw new Error(`Backup path already exists: ${backupPath}`);
    const backupImage = sourceDb.serialize();
    writeFileSync(backupPath, backupImage, { flag: "wx", mode: 0o600 });
    syncFile(backupPath);
    const backupHash = hashFile(backupPath);
    if (backupHash !== hashBytes(backupImage)) throw new Error("Backup hash changed after write");

    const backupDb = new Database(backupPath, { readonly: true });
    backupDb.run("PRAGMA foreign_keys = ON");
    const backupIntegrity = checkIntegrity(backupDb);
    assertIntegrity(backupIntegrity, "backup");
    const backupSnapshot = snapshotStore(backupDb);
    backupDb.close();
    if (backupSnapshot.sha256 !== evidence.before.sha256) {
      throw new Error("Verified backup contents do not match the locked source snapshot");
    }
    evidence.backup = {
      path: backupPath,
      bytes: statSync(backupPath).size,
      sha256: backupHash,
      integrity: backupIntegrity,
      verified: true,
    };
    checkpoint(evidencePath, evidence, "backup_created_and_verified", now, {
      sha256: backupHash,
      bytes: evidence.backup.bytes,
    });

    if (existsSync(workPath)) throw new Error(`Working path already exists: ${workPath}`);
    writeFileSync(workPath, backupImage, { flag: "wx", mode: 0o600 });
    syncFile(workPath);
    workDb = new Database(workPath);
    workDb.run("PRAGMA busy_timeout = 5000");
    workDb.run("PRAGMA foreign_keys = ON");
    runMigrations(workDb);
    ensureAgentIdentitySchema(workDb);
    backfillTaskTags(workDb);
    backfillMachineId(workDb);

    const transformedHash = calculateCurrentSchemaHash(workDb);
    if (transformedHash !== CURRENT_SCHEMA_HASH) {
      throw new Error(`Transformed schema hash ${transformedHash} does not match ${CURRENT_SCHEMA_HASH}`);
    }
    markCurrent(workDb, now().toISOString());
    const transformedState = inspectLocalSchema(workDb);
    if (transformedState.kind !== "current") {
      throw new Error(`Transformed store did not reach current state: ${JSON.stringify(transformedState)}`);
    }
    const transformedIntegrity = checkIntegrity(workDb);
    assertIntegrity(transformedIntegrity, "transformed store");
    evidence.after = snapshotStore(workDb);
    checkpoint(evidencePath, evidence, "transform_verified", now, {
      schema_sha256: transformedHash,
      data_sha256: evidence.after.sha256,
      total_rows: evidence.after.total_rows,
    });
    workDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    workDb.close();
    workDb = null;
    syncFile(workPath);

    if (sourceLocked) {
      sourceDb.exec("ROLLBACK");
      sourceLocked = false;
    }
    sourceDb.close();

    let movedOriginal = false;
    try {
      renameSync(source, originalPath);
      movedOriginal = true;
      evidence.recovery.original_wal_path = moveIfPresent(`${source}-wal`, originalWalPath);
      evidence.recovery.original_shm_path = moveIfPresent(`${source}-shm`, originalShmPath);
      renameSync(workPath, source);
    } catch (error) {
      if (movedOriginal && !existsSync(source) && existsSync(originalPath)) renameSync(originalPath, source);
      throw error;
    }

    const installed = new Database(source, { readonly: true });
    const installedState = inspectLocalSchema(installed);
    const installedIntegrity = checkIntegrity(installed);
    const installedSnapshot = snapshotStore(installed);
    installed.close();
    if (installedState.kind !== "current") {
      throw new Error(`Cutover verification found ${JSON.stringify(installedState)}`);
    }
    assertIntegrity(installedIntegrity, "installed store");
    if (installedSnapshot.sha256 !== evidence.after.sha256) {
      throw new Error("Installed data hash differs from the verified transformed store");
    }

    evidence.status = "complete";
    evidence.completed_at = now().toISOString();
    checkpoint(evidencePath, evidence, "cutover_verified", now, {
      installed_data_sha256: installedSnapshot.sha256,
      backup_sha256: evidence.backup.sha256,
    });
    return { status: "complete", evidence_path: evidencePath, backup_path: backupPath };
  } catch (error) {
    if (workDb) {
      try { workDb.close(); } catch { /* already closed */ }
    }
    if (sourceLocked) {
      try { sourceDb.exec("ROLLBACK"); } catch { /* lock already gone */ }
    }
    try { sourceDb.close(); } catch { /* already closed */ }
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.message : String(error);
    evidence.completed_at = now().toISOString();
    evidence.checkpoints.push({ name: "failed", at: now().toISOString(), details: { error: evidence.error } });
    atomicWriteJson(evidencePath, evidence);
    throw error;
  }
}

function usage(): never {
  console.error(
    "Usage: bun tools/schema-upgrader/v68/upgrade.ts --database <todos.db> [--backup <backup.db>] [--evidence <evidence.json>]",
  );
  process.exit(2);
}

function parseArgs(args: string[]): UpgradeOptions {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value) usage();
    if (!new Set(["--database", "--backup", "--evidence"]).has(flag)) usage();
    values[flag.slice(2)] = value;
  }
  if (!values["database"]) usage();
  return { database: values["database"], backup: values["backup"], evidence: values["evidence"] };
}

if (import.meta.main) {
  try {
    const result = upgradeDatabase(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
