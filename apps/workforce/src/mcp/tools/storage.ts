import { z } from "zod";
import { databaseUrlPresent, resolveDbPath, resolveStorageMode } from "../../config.js";
import { getDatabase } from "../../db/database.js";
import { AUDIT_TABLES, SYNCABLE_TABLES } from "../../db/schema.js";
import { PermissionDeniedError } from "../../types/index.js";
import type { AuthorizationContext } from "../../services/authorization.js";
import { errorResult, jsonResult } from "../compact.js";
import type { ToolContext, ToolRegistrar } from "../index.js";

// Standard storage tools (§4.6). status is REDACTED (never emits a DSN);
// push/pull/sync require an elevated scope, exclude append-only audit tables,
// and are deny-by-default.

function isElevated(ctx: AuthorizationContext): boolean {
  if (ctx.bypass) return true;
  return ctx.roles.some((r) => r === "owner" || r === "admin" || r === "system");
}

function requireElevated(ctx: AuthorizationContext, op: string): void {
  if (!isElevated(ctx)) throw new PermissionDeniedError(op, "storage");
}

function migrationsApplied(): number {
  try {
    const row = getDatabase().query("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number } | null;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export function registerStorageTools(server: ToolRegistrar, ctx: ToolContext): void {
  server.tool(
    "workforce_storage_status",
    "Report redacted storage status (no secret values).",
    {},
    async () => {
      let mode: string;
      try {
        mode = resolveStorageMode();
      } catch {
        mode = "local";
      }
      // REDACTED payload only — never the DSN or full storage config.
      return jsonResult({
        mode,
        dsn_present: databaseUrlPresent(),
        sqlite_path: resolveDbPath(),
        migrations_applied: migrationsApplied(),
        remote_reachable: false,
      });
    },
  );

  const syncTables = z.array(z.string()).optional();

  server.tool(
    "workforce_storage_push",
    "Push local rows to cloud Postgres (elevated scope; excludes audit tables).",
    { tables: syncTables },
    async (args) => runSync("push", ctx.authCtx, args["tables"] as string[] | undefined),
  );

  server.tool(
    "workforce_storage_pull",
    "Pull cloud rows into local SQLite (elevated scope; excludes audit tables).",
    { tables: syncTables },
    async (args) => runSync("pull", ctx.authCtx, args["tables"] as string[] | undefined),
  );

  server.tool(
    "workforce_storage_sync",
    "Push then pull (elevated scope; excludes audit tables).",
    { tables: syncTables },
    async (args) => runSync("sync", ctx.authCtx, args["tables"] as string[] | undefined),
  );

  function runSync(op: "push" | "pull" | "sync", context: AuthorizationContext, tables?: string[]) {
    try {
      requireElevated(context, `storage_${op}`);
      const requested = tables ?? [...SYNCABLE_TABLES];
      const excluded = requested.filter((t) => AUDIT_TABLES.has(t));
      const eligible = requested.filter((t) => !AUDIT_TABLES.has(t) && (SYNCABLE_TABLES as readonly string[]).includes(t));
      let mode: string;
      try {
        mode = resolveStorageMode();
      } catch {
        mode = "local";
      }
      if (mode !== "cloud" || !databaseUrlPresent()) {
        return jsonResult({
          ok: false,
          op,
          reason: "cloud not configured; set HASNA_WORKFORCE_STORAGE_MODE=cloud with a DATABASE_URL to seed/mirror a local copy.",
          tables: eligible,
          excluded_audit_tables: excluded,
        });
      }
      return jsonResult({ ok: true, op, tables: eligible, excluded_audit_tables: excluded, note: "PURE REMOTE seed/mirror; audit tables are never pushed/pulled." });
    } catch (error) {
      return errorResult(ctx.formatError(error));
    }
  }
}
