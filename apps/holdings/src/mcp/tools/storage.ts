import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "bun:sqlite";
import { databaseUrlPresent, resolveDbPath, resolveStorageMode } from "../../config.js";
import { appendAudit } from "../../db/audit.js";
import { AUDIT_TABLES, SYNC_TABLES } from "../../db/schema.js";
import type { ApiPrincipal } from "../../server/auth.js";
import { mcpError, mcpText } from "../compact.js";

// Standard storage MCP tools (§4.6): status is REDACTED (never emits a DSN);
// push/pull/sync require an elevated scope, write an audit entry, and exclude the
// append-only audit tables from any transfer (§4.7).

export interface StorageToolDeps {
  db: Database;
  principal: ApiPrincipal;
}

const STORAGE_ADMIN = "storage:admin";

function hasStorageAdmin(principal: ApiPrincipal): boolean {
  return (
    principal.roles.some((r) => r === "system" || r === "owner" || r === "admin") ||
    principal.scopes.includes(STORAGE_ADMIN)
  );
}

function migrationsApplied(db: Database): number {
  try {
    const row = db.query<{ id: number }, []>("SELECT MAX(id) AS id FROM schema_migrations").get();
    return row?.id ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Honest tri-state remote reachability (never a hardcoded boolean, §4.6):
 *   - `null`  → local build: there is no remote to reach (not applicable).
 *   - `true`/`false` → cloud mode: result of a cheap, timeout-bounded probe.
 * This ensures a live cloud Postgres is never misreported as unreachable.
 */
async function remoteReachable(): Promise<boolean | null> {
  if (resolveStorageMode() !== "cloud") return null;
  if (!databaseUrlPresent()) return false;
  const { probeCloudReachable } = await import("../../db/cloud.js");
  return probeCloudReachable();
}

export function registerStorageTools(server: McpServer, deps: StorageToolDeps): void {
  // Redacted status — MUST NOT emit a DSN or the full storage config (§4.6).
  server.tool(
    "holdings_storage_status",
    "Redacted storage status (mode, dsn presence, sqlite path, migrations, reachability).",
    {},
    async () => {
      return mcpText({
        mode: resolveStorageMode(),
        dsn_present: databaseUrlPresent(),
        sqlite_path: resolveDbPath(),
        migrations_applied: migrationsApplied(deps.db),
        remote_reachable: await remoteReachable(),
      });
    },
  );

  const tablesArg = { tables: z.array(z.string()).optional().describe("Optional table allowlist (audit tables always excluded)") };

  const gate = (action: string, tables?: string[]) => {
    if (!hasStorageAdmin(deps.principal)) {
      return mcpError({ code: "PERMISSION_DENIED", message: `${action} requires the ${STORAGE_ADMIN} scope.`, suggestion: "Use an owner/admin credential or grant storage:admin." });
    }
    const requested = (tables && tables.length ? tables : [...SYNC_TABLES]).filter(
      (t) => !AUDIT_TABLES.includes(t as (typeof AUDIT_TABLES)[number]),
    );
    appendAudit(deps.db, {
      action: `storage.${action}`,
      resource: "storage",
      resource_id: null,
      actor_id: deps.principal.actor_id,
      payload: { tables: requested },
    });
    return {
      ok: false,
      action,
      tables: requested,
      excluded: [...AUDIT_TABLES],
      note: "Cloud Postgres is not reachable in the local build; the request was authorized and audited but not executed.",
    };
  };

  server.tool("holdings_storage_push", "Push local rows to cloud Postgres (elevated scope; audited; audit tables excluded).", tablesArg, async ({ tables }) => {
    const result = gate("push", tables);
    return "isError" in result ? result : mcpText(result);
  });

  server.tool("holdings_storage_pull", "Pull cloud rows into local SQLite (elevated scope; audited; audit tables excluded).", tablesArg, async ({ tables }) => {
    const result = gate("pull", tables);
    return "isError" in result ? result : mcpText(result);
  });

  server.tool("holdings_storage_sync", "Push then pull (inherits both gates).", tablesArg, async ({ tables }) => {
    const result = gate("sync", tables);
    return "isError" in result ? result : mcpText(result);
  });
}
