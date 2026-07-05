import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_STORAGE_TABLES,
  detectAndLogConflicts,
  ensureConflictsTable,
  getCanonicalConversationsRdsConfig,
  getStorageConfig,
  getStorageDatabaseUrl,
  getStoragePg,
  getStorageReadiness,
  listConflicts,
  listDuplicateMessageUuids,
  resolveTables,
  runStorageMigrations,
  saveFeedback,
  storageSync,
  syncPull,
  syncPush,
} from "../../lib/storage-sync.js";
import { getDb } from "../../lib/db.js";
import { PG_MIGRATIONS } from "../../lib/pg-migrations.js";

export function registerStorageSyncTools(server: McpServer): void {
  server.tool(
    "conversations_storage_status",
    "Show remote storage configuration, connection health, and sync status",
    {},
    async () => {
      try {
        const config = getStorageConfig();
        const canonical = getCanonicalConversationsRdsConfig();
        const readiness = getStorageReadiness();
        const lines = [
          `Mode: ${config.mode}`,
          "Service: conversations",
          `Canonical RDS cluster: ${canonical.cluster}`,
          `Canonical database: ${canonical.database}`,
          `Runtime secret path: ${canonical.runtimeSecretPath}`,
          `Database env: ${canonical.env} (fallback: ${canonical.fallbackEnv})`,
          `RDS Host: ${config.rds.host || (getStorageDatabaseUrl() ? "(env database url)" : "(not configured)")}`,
          `Default sync group: metadata (${DEFAULT_STORAGE_TABLES.join(", ")})`,
          `Cloud runtime group: cloud-runtime (${readiness.tableGroups.cloudRuntime.join(", ")})`,
          "Attachments: local files only; S3 object storage is an approval-gated follow-up.",
        ];

        if (config.mode === "local" && !getStorageDatabaseUrl()) {
          lines.push("PostgreSQL: skipped in local mode");
        } else {
          try {
            const pg = await getStoragePg();
            await pg.get("SELECT 1 as ok");
            lines.push("PostgreSQL: connected");
            await pg.close();
          } catch (error) {
            lines.push(`PostgreSQL: failed - ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        try {
          const local = getDb();
          ensureConflictsTable(local);
          const unresolved = listConflicts(local, { resolved: false });
          const resolved = listConflicts(local, { resolved: true });
          lines.push(`Sync conflicts: ${unresolved.length} unresolved, ${resolved.length} resolved`);
          lines.push(`Message UUID duplicates: ${listDuplicateMessageUuids(local).length}`);
        } catch {}

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_storage_readiness",
    "Show local SQLite, remote PostgreSQL, message/read-state, digest/search, attachment, and production migration readiness without exposing secrets",
    {},
    async () => {
      try {
        const readiness = getStorageReadiness();
        return { content: [{ type: "text", text: JSON.stringify(readiness, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_storage_push",
    "Push local conversations data to remote PostgreSQL storage. Detects conflicts and syncs safe text-key tables.",
    {
      tables: z.string().optional().describe("Comma-separated table names (default: safe sync tables)"),
    },
    async ({ tables }) => {
      try {
        const config = getStorageConfig();
        if (config.mode === "local" && !getStorageDatabaseUrl()) {
          return { content: [{ type: "text", text: "Error: remote storage is not configured." }], isError: true };
        }

        const tableList = resolveTables(tables);
        const local = getDb();
        const pg = await getStoragePg();
        await runStorageMigrations(pg);

        let totalConflicts = 0;
        for (const table of tableList) totalConflicts += await detectAndLogConflicts(local, pg, table);
        const results = await syncPush(local, pg, { tables: tableList });
        await pg.close();

        return { content: [{ type: "text", text: formatSyncSummary("Pushed", results, tableList.length, totalConflicts) }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_storage_pull",
    "Pull remote PostgreSQL storage data to local SQLite. Detects conflicts and merges by configured primary keys.",
    {
      tables: z.string().optional().describe("Comma-separated table names (default: safe sync tables)"),
    },
    async ({ tables }) => {
      try {
        const config = getStorageConfig();
        if (config.mode === "local" && !getStorageDatabaseUrl()) {
          return { content: [{ type: "text", text: "Error: remote storage is not configured." }], isError: true };
        }

        const tableList = resolveTables(tables);
        const local = getDb();
        const pg = await getStoragePg();
        await runStorageMigrations(pg);

        let totalConflicts = 0;
        for (const table of tableList) totalConflicts += await detectAndLogConflicts(local, pg, table);
        const results = await syncPull(pg, local, { tables: tableList });
        await pg.close();

        return { content: [{ type: "text", text: formatSyncSummary("Pulled", results, tableList.length, totalConflicts) }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_storage_sync",
    "Bidirectional storage sync - pull remote changes then push local changes.",
    {
      tables: z.string().optional().describe("Comma-separated table names (default: safe sync tables)"),
    },
    async ({ tables }) => {
      try {
        const config = getStorageConfig();
        if (config.mode === "local" && !getStorageDatabaseUrl()) {
          return { content: [{ type: "text", text: "Error: remote storage is not configured." }], isError: true };
        }
        const result = await storageSync({ tables });
        const pullTotal = result.pull.reduce((sum, item) => sum + item.rowsWritten, 0);
        const pushTotal = result.push.reduce((sum, item) => sum + item.rowsWritten, 0);
        const tableCount = resolveTables(tables).length;
        return { content: [{ type: "text", text: `Sync complete: pulled ${pullTotal} rows, pushed ${pushTotal} rows across ${tableCount} table(s).` }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_storage_migrate",
    "Run PostgreSQL migrations against the configured RDS instance to initialize the remote storage schema",
    {
      dry_run: z.boolean().optional().describe("Print SQL without executing"),
    },
    async ({ dry_run }) => {
      try {
        const config = getStorageConfig();
        if (config.mode === "local" && !getStorageDatabaseUrl()) {
          return { content: [{ type: "text", text: "Error: remote storage is not configured." }], isError: true };
        }

        if (dry_run) {
          return { content: [{ type: "text", text: PG_MIGRATIONS.join("\n\n---\n\n") }] };
        }

        const lines: string[] = [];
        const pg = await getStoragePg();
        try {
          await runStorageMigrations(pg);
          lines.push(`Applied ${PG_MIGRATIONS.length} migration(s).`);
        } finally {
          await pg.close();
        }
        lines.push("All migrations applied successfully.");
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_storage_feedback",
    "Send feedback for the conversations service",
    {
      message: z.string().describe("Feedback message"),
      email: z.string().optional().describe("Contact email"),
    },
    async ({ message, email }) => {
      try {
        const result = saveFeedback(message, email);
        return {
          content: [{
            type: "text",
            text: result.sent
              ? `Feedback sent (id: ${result.id})`
              : `Saved locally (id: ${result.id}): ${result.error}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );
}

function formatSyncSummary(label: string, results: Array<{ rowsWritten: number; errors: string[] }>, tableCount: number, conflicts: number): string {
  const total = results.reduce((sum, result) => sum + result.rowsWritten, 0);
  const errors = results.flatMap((result) => result.errors);
  const lines = [`${label} ${total} rows across ${tableCount} table(s).`];
  if (conflicts > 0) lines.push(`Conflicts detected: ${conflicts} (logged to _sync_conflicts)`);
  if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);
  return lines.join("\n");
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export { DEFAULT_STORAGE_TABLES };
