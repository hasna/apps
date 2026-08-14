import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { Pool, PoolConfig } from "pg";

export type MarkdownStorageTable = "feedback";
export type StorageDirection = "push" | "pull" | "sync";

export interface FeedbackRecord {
  id: string;
  message: string;
  email?: string | null;
  category: string;
  version?: string | null;
  machine_id: string;
  created_at: string;
}

export interface SaveFeedbackInput {
  message: string;
  email?: string | null;
  category?: string | null;
  version?: string | null;
  machineId?: string;
}

export interface MarkdownStorageStatus {
  localPath: string;
  machineId: string;
  remoteConfigured: boolean;
  remoteEnv?: "HASNA_MARKDOWN_DATABASE_URL" | "MARKDOWN_DATABASE_URL";
  tables: MarkdownStorageTable[];
  runtimeStorage: "local-sqlite";
  remoteRole: "optional-postgres-mirror";
  deletePropagation: false;
  conflictPolicy: "feedback-is-append-only";
}

export interface StorageSyncResult {
  direction: StorageDirection;
  localPath: string;
  machineId: string;
  remoteConfigured: boolean;
  remoteEnv?: "HASNA_MARKDOWN_DATABASE_URL" | "MARKDOWN_DATABASE_URL";
  rowsRead: number;
  rowsWritten: number;
  errors: string[];
}

type Env = Record<string, string | undefined>;

const TABLES: MarkdownStorageTable[] = ["feedback"];

export function getMarkdownDataDir(env: Env = process.env): string {
  const configured = firstNonEmpty(env.HASNA_MARKDOWN_DIR, env.MARKDOWN_DIR);
  return configured ?? join(homedir(), ".hasna", "markdown");
}

export function getMarkdownDbPath(env: Env = process.env): string {
  return join(getMarkdownDataDir(env), "markdown.db");
}

export function ensureMarkdownDataDir(env: Env = process.env): string {
  const dir = getMarkdownDataDir(env);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodIfExists(dir, 0o700);
  return dir;
}

export function resolveMachineId(env: Env = process.env): string {
  return firstNonEmpty(
    env.HASNA_MARKDOWN_MACHINE_ID,
    env.MARKDOWN_MACHINE_ID,
    env.HASNA_MACHINE_ID,
    env.OPEN_MACHINES_ID,
    env.MACHINE_ID
  ) ?? hostname();
}

export function resolveRemoteDatabaseUrl(env: Env = process.env):
  | { url: string; envName: "HASNA_MARKDOWN_DATABASE_URL" | "MARKDOWN_DATABASE_URL" }
  | undefined {
  const primary = trimToValue(env.HASNA_MARKDOWN_DATABASE_URL);
  if (primary) return { url: primary, envName: "HASNA_MARKDOWN_DATABASE_URL" };

  const fallback = trimToValue(env.MARKDOWN_DATABASE_URL);
  if (fallback) return { url: fallback, envName: "MARKDOWN_DATABASE_URL" };

  return undefined;
}

export function storageStatus(env: Env = process.env): MarkdownStorageStatus {
  const remote = resolveRemoteDatabaseUrl(env);
  ensureMarkdownDataDir(env);

  return {
    localPath: getMarkdownDbPath(env),
    machineId: resolveMachineId(env),
    remoteConfigured: remote !== undefined,
    remoteEnv: remote?.envName,
    tables: [...TABLES],
    runtimeStorage: "local-sqlite",
    remoteRole: "optional-postgres-mirror",
    deletePropagation: false,
    conflictPolicy: "feedback-is-append-only",
  };
}

export function openMarkdownDatabase(env: Env = process.env): Database {
  const dbPath = getMarkdownDbPath(env);
  const dir = ensureMarkdownDataDir(env);

  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      email TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      version TEXT,
      machine_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  chmodIfExists(dbPath, 0o600);
  chmodIfExists(`${dbPath}-wal`, 0o600);
  chmodIfExists(`${dbPath}-shm`, 0o600);
  return db;
}

export function saveFeedback(input: SaveFeedbackInput, env: Env = process.env): FeedbackRecord {
  const message = input.message.trim();
  if (!message) {
    throw new Error("Feedback message is required");
  }

  const record: FeedbackRecord = {
    id: randomUUID(),
    message,
    email: trimToValue(input.email ?? undefined) ?? null,
    category: trimToValue(input.category ?? undefined) ?? "general",
    version: trimToValue(input.version ?? undefined) ?? null,
    machine_id: input.machineId ?? resolveMachineId(env),
    created_at: new Date().toISOString(),
  };

  const db = openMarkdownDatabase(env);
  try {
    db.prepare(
      "INSERT INTO feedback (id, message, email, category, version, machine_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(record.id, record.message, record.email ?? null, record.category, record.version ?? null, record.machine_id, record.created_at);
  } finally {
    db.close();
  }

  return record;
}

export function listFeedback(env: Env = process.env): FeedbackRecord[] {
  const db = openMarkdownDatabase(env);
  try {
    return db.query("SELECT id, message, email, category, version, machine_id, created_at FROM feedback ORDER BY created_at, id").all() as FeedbackRecord[];
  } finally {
    db.close();
  }
}

export function buildPostgresPoolConfig(databaseUrl: string, env: Env = process.env): PoolConfig {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const explicitMode = parsed.searchParams.get("sslmode")?.trim().toLowerCase();
  const ambientMode = env.PGSSLMODE?.trim().toLowerCase();
  const mode = explicitMode || ambientMode;

  if (mode && ["disable", "allow", "prefer"].includes(mode) && !local) {
    throw new Error(`Unsafe sslmode '${mode}' is not allowed for remote Markdown storage`);
  }

  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("ssl");

  const needsTls = !local || mode === "require" || mode === "verify-ca" || mode === "verify-full";

  return {
    connectionString: parsed.toString(),
    ssl: needsTls,
  };
}

export async function storagePush(env: Env = process.env): Promise<StorageSyncResult> {
  const result = baseSyncResult("push", env);
  const remote = resolveRemoteDatabaseUrl(env);
  if (!remote) {
    result.errors.push("No remote database configured. Set HASNA_MARKDOWN_DATABASE_URL or MARKDOWN_DATABASE_URL.");
    return result;
  }

  result.remoteConfigured = true;
  result.remoteEnv = remote.envName;

  let pool: Pool | undefined;
  try {
    const rows = listFeedback(env);
    result.rowsRead = rows.length;
    pool = await createRemotePool(remote.url, env);
    await ensureRemoteSchema(pool);
    for (const row of rows) {
      const inserted = await pool.query(
        `INSERT INTO feedback (id, message, email, category, version, machine_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.message, row.email ?? null, row.category, row.version ?? null, row.machine_id, row.created_at]
      );
      result.rowsWritten += inserted.rowCount ?? 0;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await pool?.end();
  }

  return result;
}

export async function storagePull(env: Env = process.env): Promise<StorageSyncResult> {
  const result = baseSyncResult("pull", env);
  const remote = resolveRemoteDatabaseUrl(env);
  if (!remote) {
    result.errors.push("No remote database configured. Set HASNA_MARKDOWN_DATABASE_URL or MARKDOWN_DATABASE_URL.");
    return result;
  }

  result.remoteConfigured = true;
  result.remoteEnv = remote.envName;

  let pool: Pool | undefined;
  let db: Database | undefined;
  try {
    pool = await createRemotePool(remote.url, env);
    db = openMarkdownDatabase(env);
    await ensureRemoteSchema(pool);
    const remoteRows = await pool.query<FeedbackRecord>(
      "SELECT id, message, email, category, version, machine_id, created_at FROM feedback ORDER BY created_at, id"
    );
    result.rowsRead = remoteRows.rows.length;

    const insert = db.prepare(
      `INSERT INTO feedback (id, message, email, category, version, machine_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    );
    for (const row of remoteRows.rows) {
      const written = insert.run(row.id, row.message, row.email ?? null, row.category, row.version ?? null, row.machine_id, row.created_at);
      result.rowsWritten += written.changes;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    db?.close();
    await pool?.end();
  }

  return result;
}

export async function storageSync(env: Env = process.env): Promise<StorageSyncResult> {
  const pushed = await storagePush(env);
  const result: StorageSyncResult = {
    ...pushed,
    direction: "sync",
  };

  if (pushed.errors.length > 0) {
    return result;
  }

  const pulled = await storagePull(env);
  result.rowsRead += pulled.rowsRead;
  result.rowsWritten += pulled.rowsWritten;
  result.errors.push(...pulled.errors);
  return result;
}

function baseSyncResult(direction: StorageDirection, env: Env): StorageSyncResult {
  const status = storageStatus(env);
  return {
    direction,
    localPath: status.localPath,
    machineId: status.machineId,
    remoteConfigured: status.remoteConfigured,
    remoteEnv: status.remoteEnv,
    rowsRead: 0,
    rowsWritten: 0,
    errors: [],
  };
}

async function createRemotePool(databaseUrl: string, env: Env) {
  const { Pool } = await import("pg");
  return new Pool(buildPostgresPoolConfig(databaseUrl, env));
}

async function ensureRemoteSchema(pool: { query: (sql: string, values?: unknown[]) => Promise<{ rowCount: number | null }> }) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      email TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      version TEXT,
      machine_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

function chmodIfExists(path: string, mode: number) {
  if (!existsSync(path)) return;
  chmodSync(path, mode);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = trimToValue(value);
    if (trimmed) return trimmed;
  }
  return undefined;
}

function trimToValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
