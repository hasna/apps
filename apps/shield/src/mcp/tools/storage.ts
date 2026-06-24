import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../../db/database.js";
import {
  getStorageStatus,
  parseStorageTables,
  pullStorageChanges,
  pushStorageChanges,
  syncStorageChanges,
} from "../../db/storage-sync.js";
import { PACKAGE_VERSION } from "../../lib/version.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function compactStorageStatus(verbose?: boolean) {
  const status = getStorageStatus();
  if (verbose) return { ...status, compact: false };

  const nonEmptyTables = status.tables.filter((table) => table.rows > 0);
  const shownTables = nonEmptyTables.slice(0, 5);
  return {
    mode: status.mode,
    enabled: status.enabled,
    db_path: status.db_path,
    tables_summary: {
      total_tables: status.tables.length,
      non_empty_tables: nonEmptyTables.length,
      rows: status.tables.reduce((sum, table) => sum + table.rows, 0),
    },
    tables: shownTables,
    shown: shownTables.length,
    compact: true,
    hint: "Call shield_storage_status with verbose=true for all table counts.",
  };
}

function err(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

export function registerShieldStorageTools(server: McpServer): void {
  server.tool(
    "shield_storage_status",
    "Show shield local database and remote storage sync status",
    {
      verbose: z.boolean().optional().describe("Return all table counts"),
    },
    async ({ verbose }) => {
      try {
        return ok(compactStorageStatus(verbose));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "shield_storage_push",
    "Push local shield data to remote PostgreSQL storage",
    {
      tables: z.string().optional().describe("Comma-separated table names"),
    },
    async ({ tables }) => {
      try {
        return ok(await pushStorageChanges(parseStorageTables(tables)));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "shield_storage_pull",
    "Pull remote PostgreSQL storage data into the local database",
    {
      tables: z.string().optional().describe("Comma-separated table names"),
    },
    async ({ tables }) => {
      try {
        return ok(await pullStorageChanges(parseStorageTables(tables)));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "shield_storage_sync",
    "Push local changes, then pull remote changes",
    {
      tables: z.string().optional().describe("Comma-separated table names"),
    },
    async ({ tables }) => {
      try {
        return ok(await syncStorageChanges(parseStorageTables(tables)));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "shield_storage_feedback",
    "Save feedback for shield",
    {
      message: z.string(),
      email: z.string().optional(),
      category: z.enum(["bug", "feature", "general"]).optional(),
    },
    async ({ message, email, category }) => {
      try {
        const db = getDb();
        db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(
          message,
          email || null,
          category || "general",
          PACKAGE_VERSION
        );
        return ok({ saved: true });
      } catch (error) {
        return err(error);
      }
    }
  );
}
