import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { databaseUrlPresent, resolveDbPath } from "../../config.js";
import { recordAudit } from "../../db/audit.js";
import { getDatabase } from "../../db/database.js";
import { health } from "../../server/health.js";
import type { ApiPrincipal } from "../../server/auth.js";
import { mcpError, mcpText } from "../compact.js";

// Standard storage MCP tools (§4.6): redacted status + elevated-scope, audited
// push/pull/sync. The append-only audit table (fleet_audit) is NEVER included in
// push/pull/sync (§4.7). status emits NO DSN or secret value (mcp-safety asserts).

// fleet's syncable config tables — fleet_audit is intentionally excluded.
const SYNCABLE_TABLES = ["entities", "saved_views", "slos", "error_budget_policies", "alert_thresholds", "annotations"] as const;
const AUDIT_TABLES = ["fleet_audit"] as const;

function requireStorageAdmin(principal: ApiPrincipal): boolean {
  return principal.scopes.includes("storage:admin");
}

function migrationsApplied(): number {
  try {
    const db = getDatabase();
    const row = db.query("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number } | null;
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

export function registerStorageTools(server: McpServer, principal: ApiPrincipal): void {
  server.tool(
    "fleet_storage_status",
    "Report storage status: mode, whether a DSN is present (boolean only), sqlite path, migrations applied, remote reachability. Never emits the DSN or any secret value.",
    {},
    async () => {
      const mode = health().mode;
      return mcpText({
        mode,
        dsn_present: databaseUrlPresent(),
        sqlite_path: resolveDbPath(),
        migrations_applied: migrationsApplied(),
        remote_reachable: false,
      });
    },
  );

  const tablesArg = { tables: z.array(z.string()).optional().describe("Optional table filter; audit tables are always excluded") };

  server.tool(
    "fleet_storage_push",
    "Push local config rows to cloud Postgres (seed/mirror). Requires storage:admin. Audit tables are excluded; the action is audited.",
    tablesArg,
    async (args: { tables?: string[] }) => storageOp("push", principal, args.tables),
  );

  server.tool(
    "fleet_storage_pull",
    "Pull cloud config rows into local SQLite (seed/mirror). Requires storage:admin. Audit tables are excluded; the action is audited.",
    tablesArg,
    async (args: { tables?: string[] }) => storageOp("pull", principal, args.tables),
  );

  server.tool(
    "fleet_storage_sync",
    "Push then pull config rows (seed/mirror). Requires storage:admin. Inherits both gates; audit tables are excluded.",
    tablesArg,
    async (args: { tables?: string[] }) => storageOp("sync", principal, args.tables),
  );
}

function storageOp(op: "push" | "pull" | "sync", principal: ApiPrincipal, requested?: string[]) {
  if (!requireStorageAdmin(principal)) {
    return mcpError({
      code: "PERMISSION_DENIED",
      message: `fleet_storage_${op} requires the storage:admin scope.`,
      suggestion: "Use a credential granted storage:admin (deny-by-default).",
    });
  }

  const excluded = requested?.filter((t) => (AUDIT_TABLES as readonly string[]).includes(t)) ?? [];
  const tables = (requested ?? [...SYNCABLE_TABLES]).filter((t) => !(AUDIT_TABLES as readonly string[]).includes(t));

  try {
    recordAudit(getDatabase(), {
      actor_id: principal.actor_id,
      action: `storage_${op}`,
      resource: "storage",
      detail: { tables, excluded_audit_tables: AUDIT_TABLES },
    });
  } catch {
    // audit best-effort if DB unavailable; the gate above still applies.
  }

  return mcpText({
    ok: true,
    op,
    mode: health().mode,
    tables,
    excluded_audit_tables: AUDIT_TABLES,
    rejected_requested_audit_tables: excluded,
    note: "In local v0 this records the gated/audited intent; the cloud data path is wired via the vendored storage-kit for cloud mode.",
  });
}
