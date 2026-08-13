import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult, errorResult } from "../compact.js";
import { getDatabase, getStorageMode } from "../../db/database.js";
import { appendAuditEvent } from "../../db/audit.js";
import { SYNCABLE_TABLES } from "../../db/schema.js";
import { databaseUrlPresent, resolveDbPath } from "../../config.js";
import { PermissionDeniedError } from "../../types/index.js";
import { hasStorageAdmin, type AuthorizationContext } from "../../services/authorization-scopes.js";
import { mcpWriteConfirmationSchema, stripMcpWriteConfirmation } from "../schemas.js";

/**
 * Standard storage MCP tools (§4.6): REDACTED status + elevated-scope-GATED
 * push/pull/sync. The status payload NEVER emits a DSN or secret value. Audit
 * tables are excluded from push/pull/sync. push/pull/sync are the mass-exfil
 * surface and are deny-by-default unless the AUTHENTICATED CALLER's principal
 * carries the storage:admin (or owner/admin/system) capability — not a
 * process-wide env flag (which is who-agnostic and would let any caller exfil).
 */

function migrationsApplied(): number {
  try {
    const row = getDatabase().query("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number } | null;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

function gatedTables(tablesArg: unknown): string[] {
  const requested = Array.isArray(tablesArg)
    ? (tablesArg as string[])
    : typeof tablesArg === "string" && tablesArg
      ? tablesArg.split(",").map((t) => t.trim())
      : [...SYNCABLE_TABLES];
  // audit_log is NEVER pushed/pulled/overwritten.
  return requested.filter((t) => (SYNCABLE_TABLES as readonly string[]).includes(t));
}

function requireStorageAdmin(action: string, ctx?: AuthorizationContext): void {
  if (!hasStorageAdmin(ctx)) {
    throw new PermissionDeniedError(action, "storage (requires a caller principal with the storage:admin / owner scope)");
  }
}

export function registerStorageTools(server: McpServer, ctx?: AuthorizationContext): void {
  server.tool(
    "access_storage_status",
    "Redacted storage status: mode, dsn_present, sqlite_path, migrations_applied, remote_reachable. NEVER emits a DSN.",
    {},
    async () => {
      const mode = getStorageMode();
      return toToolResult({
        mode,
        dsn_present: databaseUrlPresent(),
        sqlite_path: mode === "local" ? resolveDbPath() : null,
        migrations_applied: migrationsApplied(),
        // NOT hardcoded false: local mode has no remote, and cloud mode is PURE
        // REMOTE but not connected in this build (openDatabase() fail-closes),
        // so remote reachability is genuinely never measured here — report null
        // ("unknown / not measured") rather than asserting an unverified state.
        remote_reachable: null,
      }) as never;
    },
  );

  const gatedSchema = { tables: z.array(z.string()).optional(), ...mcpWriteConfirmationSchema };

  server.tool("access_storage_push", "Push local rows to cloud Postgres (elevated scope; audited; excludes audit tables).", gatedSchema, async (args: Record<string, unknown>) => {
    try {
      const clean = stripMcpWriteConfirmation(args ?? {}, "access_storage_push");
      requireStorageAdmin("storage_push", ctx);
      const tables = gatedTables(clean.tables);
      appendAuditEvent(getDatabase(), { event_type: "storage.push", actor: "mcp", payload: { tables } });
      return toToolResult({ ok: true, direction: "push", tables, note: "cloud not connected in local mode; push is a no-op mirror stub" }) as never;
    } catch (error) {
      return errorResult(error) as never;
    }
  });

  server.tool("access_storage_pull", "Pull cloud rows into local SQLite (elevated scope; audited; excludes audit tables).", gatedSchema, async (args: Record<string, unknown>) => {
    try {
      const clean = stripMcpWriteConfirmation(args ?? {}, "access_storage_pull");
      requireStorageAdmin("storage_pull", ctx);
      const tables = gatedTables(clean.tables);
      appendAuditEvent(getDatabase(), { event_type: "storage.pull", actor: "mcp", payload: { tables } });
      return toToolResult({ ok: true, direction: "pull", tables, note: "cloud not connected in local mode; pull is a no-op mirror stub" }) as never;
    } catch (error) {
      return errorResult(error) as never;
    }
  });

  server.tool("access_storage_sync", "Push then pull (inherits both elevated-scope gates).", gatedSchema, async (args: Record<string, unknown>) => {
    try {
      const clean = stripMcpWriteConfirmation(args ?? {}, "access_storage_sync");
      requireStorageAdmin("storage_sync", ctx);
      const tables = gatedTables(clean.tables);
      appendAuditEvent(getDatabase(), { event_type: "storage.sync", actor: "mcp", payload: { tables } });
      return toToolResult({ ok: true, direction: "sync", tables, note: "cloud not connected in local mode; sync is a no-op mirror stub" }) as never;
    } catch (error) {
      return errorResult(error) as never;
    }
  });
}
