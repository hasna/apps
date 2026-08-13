import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { openDatabase } from "../../db/database.js";
import { contextFromPrincipal } from "../../services/context.js";
import type { ApiPrincipal } from "../../server/auth.js";
import { storagePull, storagePush, storageStatus, storageSync } from "../../services/storage.js";
import { ok, fail } from "../compact.js";

// treasury_storage_{status,push,pull,sync} — redacted status + elevated-scope,
// audited, audit-table-excluding push/pull/sync (BUILD-SPEC §4.6). Always
// registered regardless of profile.
function readArgs(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

export function registerStorageTools(server: McpServer, principal: ApiPrincipal): void {
  const rc = async () => contextFromPrincipal(await openDatabase(), principal);

  server.tool("treasury_storage_status", "Redacted storage status (no DSN/secret values).", {}, async () => {
    try {
      return ok(await storageStatus(await rc()));
    } catch (e) {
      return fail(e);
    }
  });

  server.tool(
    "treasury_storage_push",
    "Push local rows to cloud Postgres (requires storage:admin). Excludes audit tables.",
    { tables: z.array(z.string()).optional() } as unknown as ZodRawShapeCompat,
    async (input: unknown) => {
      try {
        const { tables } = readArgs(input) as { tables?: string[] };
        return ok(await storagePush(await rc(), tables ? { tables } : {}));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "treasury_storage_pull",
    "Pull cloud rows into local SQLite (requires storage:admin). Excludes audit tables.",
    { tables: z.array(z.string()).optional() } as unknown as ZodRawShapeCompat,
    async (input: unknown) => {
      try {
        const { tables } = readArgs(input) as { tables?: string[] };
        return ok(await storagePull(await rc(), tables ? { tables } : {}));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "treasury_storage_sync",
    "Push then pull (requires storage:admin). Excludes audit tables.",
    { tables: z.array(z.string()).optional() } as unknown as ZodRawShapeCompat,
    async (input: unknown) => {
      try {
        const { tables } = readArgs(input) as { tables?: string[] };
        return ok(await storageSync(await rc(), tables ? { tables } : {}));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
