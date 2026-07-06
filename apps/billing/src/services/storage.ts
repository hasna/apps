import type { Database } from "bun:sqlite";
import { appendAudit } from "../db/audit.js";
import { appliedMigrationCount, probeCloudReachable } from "../db/database.js";
import { databaseUrlPresent, resolveDbPath, resolveStorageMode } from "../config.js";
import { type AuthorizationContext } from "./authorization.js";
import { requireScopes } from "./scopes.js";

/**
 * Storage tool logic shared by the MCP storage tools and (optionally) the serve
 * tier. status is REDACTED — never emits a DSN or the full storage config
 * (BUILD-SPEC §4.6). push/pull/sync require an elevated scope (storage:admin),
 * write an audit entry, and EXCLUDE append-only audit tables (§4.6/§4.7).
 */

/** Tables that may be mirrored. Audit + ledger tables are excluded forever. */
export const SYNCABLE_TABLES = ["customers", "subscriptions", "invoices", "dunning_policies", "dunning_runs", "events"] as const;
export const EXCLUDED_TABLES = ["audit_log", "schema_migrations"] as const;

export interface StorageStatus {
  mode: "local" | "cloud";
  dsn_present: boolean;
  sqlite_path: string;
  migrations_applied: number;
  remote_reachable: boolean;
}

/** Redacted status. remote_reachable is PROBED, never hardcoded (§4.6/failure class 2). */
export async function storageStatus(db: Database): Promise<StorageStatus> {
  const mode = resolveStorageMode();
  return {
    mode,
    dsn_present: databaseUrlPresent(),
    sqlite_path: mode === "local" ? resolveDbPath() : "(cloud: PURE REMOTE Postgres)",
    migrations_applied: appliedMigrationCount(db),
    remote_reachable: await probeCloudReachable(),
  };
}

export interface StorageMoveResult {
  direction: "push" | "pull" | "sync";
  tables: string[];
  excluded: string[];
  moved: boolean;
  detail: string;
}

function resolveTables(requested?: string[]): { tables: string[]; excluded: string[] } {
  const excluded = [...EXCLUDED_TABLES];
  if (!requested || requested.length === 0) return { tables: [...SYNCABLE_TABLES], excluded };
  const tables = requested.filter((t) => (SYNCABLE_TABLES as readonly string[]).includes(t));
  const rejected = requested.filter((t) => (EXCLUDED_TABLES as readonly string[]).includes(t));
  return { tables, excluded: [...excluded, ...rejected] };
}

async function move(
  db: Database,
  principal: AuthorizationContext,
  direction: "push" | "pull" | "sync",
  requested?: string[],
): Promise<StorageMoveResult> {
  // Deny-by-default: mass import/export requires an elevated scope (§4.6).
  requireScopes(principal, ["storage:admin"]);
  const { tables, excluded } = resolveTables(requested);

  const reachable = await probeCloudReachable();
  const moved = false;
  const detail = reachable
    ? `cloud reachable; ${direction} of ${tables.length} table(s) would proceed`
    : `cloud target not reachable — ${direction} fails closed (no ephemeral/partial write)`;

  appendAudit(db, {
    entity_id: null,
    actor_id: principal.actor_id,
    action: `storage_${direction}`,
    resource: "storage",
    resource_id: null,
    detail: `tables=[${tables.join(",")}] excluded=[${excluded.join(",")}] moved=${moved}`,
  });

  if (!reachable) {
    throw new Error(
      `storage_${direction} requires a reachable cloud Postgres target (PURE REMOTE). ` +
        `It fails closed rather than silently writing money/audit data to ephemeral storage. ` +
        `Configure HASNA_BILLING_DATABASE_URL (sslmode=verify-full) and retry.`,
    );
  }

  return { direction, tables, excluded, moved, detail };
}

export function storagePush(db: Database, principal: AuthorizationContext, tables?: string[]): Promise<StorageMoveResult> {
  return move(db, principal, "push", tables);
}
export function storagePull(db: Database, principal: AuthorizationContext, tables?: string[]): Promise<StorageMoveResult> {
  return move(db, principal, "pull", tables);
}
export async function storageSync(db: Database, principal: AuthorizationContext, tables?: string[]): Promise<StorageMoveResult> {
  requireScopes(principal, ["storage:admin"]);
  await storagePush(db, principal, tables);
  return storagePull(db, principal, tables);
}
