import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerDbBackupTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("backup_database")) {
    server.tool(
      "backup_database",
      "Create a local atomic backup of the todos SQLite database.",
      {
        output_path: z.string().optional(),
        db_path: z.string().optional(),
      },
      async ({ output_path, db_path }) => {
        try {
          const { backupDatabase, defaultBackupPath } = await import("../../lib/db-backup.js");
          const path = output_path ?? defaultBackupPath(db_path);
          const result = backupDatabase(path, db_path);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("restore_database")) {
    server.tool(
      "restore_database",
      "Restore todos SQLite database from a local backup file.",
      {
        backup_path: z.string(),
        target_path: z.string().optional(),
      },
      async ({ backup_path, target_path }) => {
        try {
          const { restoreDatabase } = await import("../../lib/db-backup.js");
          const result = restoreDatabase(backup_path, target_path);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_database_integrity")) {
    server.tool(
      "check_database_integrity",
      "Run PRAGMA quick_check and foreign key validation on local SQLite DB.",
      { db_path: z.string().optional() },
      async ({ db_path }) => {
        try {
          const { checkDatabaseIntegrity } = await import("../../lib/db-backup.js");
          const result = checkDatabaseIntegrity(db_path);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("migration_dry_run")) {
    server.tool(
      "migration_dry_run",
      "List pending SQLite migrations without applying them.",
      { db_path: z.string().optional() },
      async ({ db_path }) => {
        try {
          const { migrationDryRun } = await import("../../lib/db-backup.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(migrationDryRun(db_path), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
