import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail } from "../compact.js";
import { getDatabase } from "../../db/database.js";
import { storagePush, storagePull, storageStatus, storageSync } from "../../services/storage.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../../services/authorization.js";
import type { ApiPrincipal } from "../../server/auth.js";

/**
 * Standard storage MCP tools (BUILD-SPEC §4.6). `status` is REDACTED — never
 * emits a DSN or the full storage config. `push`/`pull`/`sync` require the
 * elevated `storage:admin` scope (threaded from the CALLER principal, not a
 * SYSTEM bypass — failure classes 1 & 4), write an audit entry, and NEVER touch
 * append-only audit tables. The gate is the authenticated caller SCOPE, not a
 * process env var.
 */
export function registerStorageTools(server: McpServer, principal: ApiPrincipal | undefined): void {
  // stdio local single-user callers have no principal → trusted system context.
  const principalCtx: AuthorizationContext = principal ?? SYSTEM_AUTHORIZATION_CONTEXT;

  server.tool(
    "billing_storage_status",
    "Redacted storage status: mode, whether a DSN is present, sqlite path, migrations applied, remote reachability. Never returns secret values.",
    {},
    async () => {
      try {
        return ok(await storageStatus(getDatabase()));
      } catch (error) {
        return fail(error);
      }
    },
  );

  const tablesArg = { tables: z.array(z.string()).optional().describe("Optional table filter (audit tables always excluded).") };

  server.tool(
    "billing_storage_push",
    "Push local rows to cloud Postgres (elevated storage:admin scope; audited; append-only audit tables excluded).",
    tablesArg,
    async ({ tables }) => {
      try {
        return ok(await storagePush(getDatabase(), principalCtx, tables));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "billing_storage_pull",
    "Pull cloud rows into local SQLite (elevated storage:admin scope; audited; append-only audit tables excluded).",
    tablesArg,
    async ({ tables }) => {
      try {
        return ok(await storagePull(getDatabase(), principalCtx, tables));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.tool(
    "billing_storage_sync",
    "Push then pull (elevated storage:admin scope; audited; append-only audit tables excluded).",
    tablesArg,
    async ({ tables }) => {
      try {
        return ok(await storageSync(getDatabase(), principalCtx, tables));
      } catch (error) {
        return fail(error);
      }
    },
  );
}
