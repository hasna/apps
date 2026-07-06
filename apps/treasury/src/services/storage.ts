import { guard, type RunContext } from "./context.js";
import { appendAudit } from "../db/audit.js";
import { openDatabase, type QueryClient } from "../db/database.js";
import { resolveDbPath, resolveStorageMode, databaseUrlPresent, type StorageMode } from "../config.js";

// Domain tables that may be mirrored between local and cloud. The append-only
// audit_log is DELIBERATELY excluded — it can never be pushed/pulled/overwritten
// (BUILD-SPEC §4.6/§4.7).
export const SYNC_TABLES: Record<string, string[]> = {
  entities: ["entity_id", "entity_slug", "name", "base_currency", "created_at", "updated_at"],
  balance_snapshots: ["id", "entity_id", "account_ref", "account_kind", "currency", "amount_minor", "as_of", "source", "captured_at"],
  fx_rates: ["id", "base_currency", "quote_currency", "rate", "as_of", "source", "captured_at"],
  cost_feeds: ["id", "entity_id", "currency", "monthly_burn_minor", "as_of", "source", "captured_at"],
  sweep_recommendations: ["id", "from_entity_id", "to_entity_id", "currency", "amount_minor", "rationale", "status", "created_at", "updated_at"],
};
export const AUDIT_TABLES = ["audit_log"];

export interface StorageStatus {
  mode: "local" | "cloud";
  dsn_present: boolean;
  sqlite_path: string;
  migrations_applied: number;
  remote_reachable: boolean;
}

/**
 * Redacted storage status (BUILD-SPEC §4.6). Emits NO DSN/secret value and NO
 * full config object. `remote_reachable` is computed by probing, never hardcoded.
 */
export async function storageStatus(rc: RunContext): Promise<StorageStatus> {
  guard(rc, "treasury:read", "read");
  const mode = resolveStorageMode();
  const migrations = await rc.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM schema_migrations");
  let remoteReachable = false;
  if (mode === "cloud") {
    try {
      const probe = await rc.db.get<{ ok: number }>("SELECT 1 AS ok");
      remoteReachable = probe?.ok === 1;
    } catch {
      remoteReachable = false;
    }
  }
  return {
    mode,
    dsn_present: databaseUrlPresent(),
    sqlite_path: resolveDbPath(),
    migrations_applied: Number(migrations?.c ?? 0),
    remote_reachable: remoteReachable,
  };
}

function assertSyncTables(tables?: string[]): string[] {
  const requested = tables && tables.length > 0 ? tables : Object.keys(SYNC_TABLES);
  for (const t of requested) {
    if (AUDIT_TABLES.includes(t)) {
      throw new Error(`Refusing to sync append-only audit table '${t}'.`);
    }
    if (!SYNC_TABLES[t]) throw new Error(`Unknown or non-syncable table '${t}'.`);
  }
  return requested;
}

async function copyTable(source: QueryClient, target: QueryClient, table: string): Promise<number> {
  const cols = SYNC_TABLES[table]!;
  const rows = await source.all<Record<string, unknown>>(`SELECT ${cols.join(", ")} FROM ${table}`);
  const idCol = cols[0]!;
  const placeholders = cols.map(() => "?").join(", ");
  for (const row of rows) {
    await target.run(`DELETE FROM ${table} WHERE ${idCol} = ?`, [row[idCol]]);
    await target.run(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`, cols.map((c) => row[c]));
  }
  return rows.length;
}

export interface SyncOptions {
  tables?: string[];
  /** Injected counterpart store (tests). When absent, the cloud store is opened. */
  target?: QueryClient;
}

export interface SyncResult {
  direction: "push" | "pull";
  tables: Record<string, number>;
  audit_excluded: string[];
}

async function counterpart(sourceMode: StorageMode, opts: SyncOptions): Promise<QueryClient> {
  if (opts.target) return opts.target;
  // Open the EXPLICIT opposite store so the transfer truly crosses local<->cloud
  // rather than re-opening the SAME store and self-copying (which was a silent
  // no-op in local mode). A local process therefore reaches the CLOUD counterpart,
  // and openDatabase fails closed (throws) if that cloud DSN is not configured —
  // never a silent same-store copy. push/pull/sync stay storage:admin-gated.
  const targetMode: StorageMode = sourceMode === "local" ? "cloud" : "local";
  return openDatabase({ fresh: true, mode: targetMode });
}

/** Push local rows to the cloud store. Elevated scope + audit; audit tables excluded. */
export async function storagePush(rc: RunContext, opts: SyncOptions = {}): Promise<SyncResult> {
  guard(rc, "storage:admin", "admin");
  const tables = assertSyncTables(opts.tables);
  const target = await counterpart(rc.db.mode, opts);
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = await copyTable(rc.db, target, t);
  await appendAudit(rc.db, { entity_id: null, actor_id: rc.auth.actor_id, action: "storage.push", detail: `tables=${tables.join(",")}` });
  return { direction: "push", tables: counts, audit_excluded: AUDIT_TABLES };
}

/** Pull cloud rows into the local store. Elevated scope + audit; audit tables excluded. */
export async function storagePull(rc: RunContext, opts: SyncOptions = {}): Promise<SyncResult> {
  guard(rc, "storage:admin", "admin");
  const tables = assertSyncTables(opts.tables);
  const source = await counterpart(rc.db.mode, opts);
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = await copyTable(source, rc.db, t);
  await appendAudit(rc.db, { entity_id: null, actor_id: rc.auth.actor_id, action: "storage.pull", detail: `tables=${tables.join(",")}` });
  return { direction: "pull", tables: counts, audit_excluded: AUDIT_TABLES };
}

export async function storageSync(rc: RunContext, opts: SyncOptions = {}): Promise<{ push: SyncResult; pull: SyncResult }> {
  guard(rc, "storage:admin", "admin");
  const push = await storagePush(rc, opts);
  const pull = await storagePull(rc, opts);
  return { push, pull };
}
