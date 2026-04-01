import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Tables excluded from default cloud sync.
 * These use integer AUTOINCREMENT PKs that collide across machines —
 * two machines generate id=1,2,3... for different rows, causing UPSERT corruption.
 * They can still be synced by passing explicit table names, but never by default.
 */
const SYNC_EXCLUDED = new Set([
  "messages",
  "reactions",
  "message_read_receipts",
  "message_mentions",
  "messages_fts",
  "_sync_conflicts",
  "_migrations",
]);

/** Tables that have created_at for conflict detection (text-PK tables only) */
const CONFLICT_TABLES = new Set(["spaces", "projects", "agent_presence"]);

/**
 * Detect conflicts between local SQLite rows and remote PG rows for a table.
 * Returns the count of conflicts found and stores them via @hasna/cloud.
 */
async function detectAndLogConflicts(
  local: any,
  cloud: any,
  table: string,
): Promise<number> {
  if (!CONFLICT_TABLES.has(table)) return 0;

  try {
    const { detectConflicts, storeConflicts } = await import("@hasna/cloud");

    // Use the right PK and timestamp columns per table
    const pk = table === "messages" ? "id" : table === "spaces" ? "name" : table === "space_members" ? "space" : "id";
    const tsCol = "created_at";

    const localRows = local.all(`SELECT * FROM "${table}"`);
    const remoteRows = await cloud.all(`SELECT * FROM "${table}"`);

    if (localRows.length === 0 || remoteRows.length === 0) return 0;

    const conflicts = detectConflicts(localRows, remoteRows, table, pk, tsCol);
    if (conflicts.length > 0) {
      storeConflicts(local, conflicts);
    }
    return conflicts.length;
  } catch {
    return 0;
  }
}

/**
 * Register enhanced cloud sync tools for conversations.
 * Replaces the generic @hasna/cloud registerCloudTools with
 * conflict detection and sync tracking.
 */
export function registerCloudSyncTools(server: McpServer): void {
  server.tool(
    "conversations_cloud_status",
    "Show cloud configuration, connection health, and sync status",
    {},
    async () => {
      try {
        const {
          getCloudConfig,
          getConnectionString,
          PgAdapterAsync,
          listConflicts,
          ensureConflictsTable,
          SqliteAdapter,
          getDbPath: cloudGetDbPath,
        } = await import("@hasna/cloud");
        const config = getCloudConfig();

        const lines = [
          `Mode: ${config.mode}`,
          `Service: conversations`,
          `RDS Host: ${config.rds.host || "(not configured)"}`,
        ];

        if (config.rds.host && config.rds.username) {
          try {
            const pg = new PgAdapterAsync(getConnectionString("postgres"));
            await pg.get("SELECT 1 as ok");
            lines.push("PostgreSQL: connected");
            await pg.close();
          } catch (err: any) {
            lines.push(`PostgreSQL: failed — ${err?.message}`);
          }
        }

        // Show unresolved conflict count
        try {
          const local = new SqliteAdapter(cloudGetDbPath("conversations"));
          ensureConflictsTable(local);
          const unresolved = listConflicts(local, { resolved: false });
          const resolved = listConflicts(local, { resolved: true });
          lines.push(`Sync conflicts: ${unresolved.length} unresolved, ${resolved.length} resolved`);
          local.close();
        } catch {}

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_cloud_push",
    "Push local conversations data to cloud PostgreSQL. Detects conflicts and syncs all tables.",
    {
      tables: z.string().optional().describe("Comma-separated table names (default: all)"),
    },
    async ({ tables: tablesStr }) => {
      try {
        const {
          getCloudConfig,
          getConnectionString,
          syncPush,
          listSqliteTables,
          SqliteAdapter,
          PgAdapterAsync,
          getDbPath: cloudGetDbPath,
        } = await import("@hasna/cloud");

        const config = getCloudConfig();
        if (config.mode === "local") {
          return { content: [{ type: "text", text: "Error: cloud mode not configured." }], isError: true };
        }

        const localPath = cloudGetDbPath("conversations");
        const local = new SqliteAdapter(localPath);
        const cloud = new PgAdapterAsync(getConnectionString("conversations"));

        const tableList = tablesStr
          ? tablesStr.split(",").map((t: string) => t.trim())
          : listSqliteTables(local).filter((t: string) => !SYNC_EXCLUDED.has(t));

        // Detect conflicts before pushing
        let totalConflicts = 0;
        for (const table of tableList) {
          totalConflicts += await detectAndLogConflicts(local, cloud, table);
        }

        const results = await syncPush(local, cloud, { tables: tableList });

        local.close();
        await cloud.close();

        const total = results.reduce((s: number, r: any) => s + r.rowsWritten, 0);
        const errors = results.flatMap((r: any) => r.errors);
        const lines = [`Pushed ${total} rows across ${tableList.length} table(s).`];
        if (totalConflicts > 0) lines.push(`Conflicts detected: ${totalConflicts} (logged to _sync_conflicts)`);
        if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_cloud_pull",
    "Pull cloud PostgreSQL data to local. Detects conflicts and merges by primary key with UPSERT.",
    {
      tables: z.string().optional().describe("Comma-separated table names (default: all)"),
    },
    async ({ tables: tablesStr }) => {
      try {
        const {
          getCloudConfig,
          getConnectionString,
          syncPull,
          listPgTables,
          SqliteAdapter,
          PgAdapterAsync,
          getDbPath: cloudGetDbPath,
        } = await import("@hasna/cloud");

        const config = getCloudConfig();
        if (config.mode === "local") {
          return { content: [{ type: "text", text: "Error: cloud mode not configured." }], isError: true };
        }

        const local = new SqliteAdapter(cloudGetDbPath("conversations"));
        const cloud = new PgAdapterAsync(getConnectionString("conversations"));

        let tableList: string[];
        if (tablesStr) {
          tableList = tablesStr.split(",").map((t: string) => t.trim());
        } else {
          try {
            tableList = (await listPgTables(cloud)).filter((t: string) => !SYNC_EXCLUDED.has(t));
          } catch {
            local.close();
            await cloud.close();
            return { content: [{ type: "text", text: "Error: failed to list cloud tables." }], isError: true };
          }
        }

        // Detect conflicts before pulling
        let totalConflicts = 0;
        for (const table of tableList) {
          totalConflicts += await detectAndLogConflicts(local, cloud, table);
        }

        const results = await syncPull(cloud, local, { tables: tableList });

        local.close();
        await cloud.close();

        const total = results.reduce((s: number, r: any) => s + r.rowsWritten, 0);
        const errors = results.flatMap((r: any) => r.errors);
        const lines = [`Pulled ${total} rows across ${tableList.length} table(s).`];
        if (totalConflicts > 0) lines.push(`Conflicts detected: ${totalConflicts} (logged to _sync_conflicts)`);
        if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_cloud_sync",
    "Bidirectional cloud sync — pull remote changes then push local changes. Detects and logs conflicts.",
    {
      tables: z.string().optional().describe("Comma-separated table names (default: all syncable tables)"),
    },
    async ({ tables: tablesStr }) => {
      try {
        const {
          getCloudConfig,
          getConnectionString,
          syncPush,
          syncPull,
          listSqliteTables,
          listPgTables,
          SqliteAdapter,
          PgAdapterAsync,
          getDbPath: cloudGetDbPath,
        } = await import("@hasna/cloud");

        const config = getCloudConfig();
        if (config.mode === "local") {
          return { content: [{ type: "text", text: "Error: cloud mode not configured." }], isError: true };
        }

        const local = new SqliteAdapter(cloudGetDbPath("conversations"));
        const cloud = new PgAdapterAsync(getConnectionString("conversations"));

        let tableList: string[];
        if (tablesStr) {
          tableList = tablesStr.split(",").map((t: string) => t.trim());
        } else {
          const localTables = new Set(listSqliteTables(local).filter((t: string) => !SYNC_EXCLUDED.has(t)));
          let remoteTables: Set<string>;
          try {
            remoteTables = new Set((await listPgTables(cloud)).filter((t: string) => !SYNC_EXCLUDED.has(t)));
          } catch {
            local.close();
            await cloud.close();
            return { content: [{ type: "text", text: "Error: failed to list cloud tables." }], isError: true };
          }
          tableList = [...new Set([...localTables, ...remoteTables])];
        }

        // Detect conflicts
        let totalConflicts = 0;
        for (const table of tableList) {
          totalConflicts += await detectAndLogConflicts(local, cloud, table);
        }

        // Step 1: Pull remote → local
        const pullResults = await syncPull(cloud, local, { tables: tableList });
        const pullTotal = pullResults.reduce((s: number, r: any) => s + r.rowsWritten, 0);

        // Step 2: Push local → remote
        const pushResults = await syncPush(local, cloud, { tables: tableList });
        const pushTotal = pushResults.reduce((s: number, r: any) => s + r.rowsWritten, 0);

        local.close();
        await cloud.close();

        const allErrors = [
          ...pullResults.flatMap((r: any) => r.errors.map((e: string) => `pull: ${e}`)),
          ...pushResults.flatMap((r: any) => r.errors.map((e: string) => `push: ${e}`)),
        ];

        const lines = [
          `Sync complete: pulled ${pullTotal} rows, pushed ${pushTotal} rows across ${tableList.length} table(s).`,
        ];
        if (totalConflicts > 0) lines.push(`Conflicts detected: ${totalConflicts} (logged to _sync_conflicts)`);
        if (allErrors.length > 0) lines.push(`Errors: ${allErrors.join("; ")}`);

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_cloud_migrate",
    "Run PostgreSQL migrations against the configured RDS instance to initialize the cloud schema",
    {
      dry_run: z.boolean().optional().describe("Print SQL without executing"),
    },
    async ({ dry_run }) => {
      try {
        const { getCloudConfig, getConnectionString, PgAdapterAsync } = await import("@hasna/cloud");
        const { PG_MIGRATIONS } = await import("../../lib/pg-migrations.js");

        const config = getCloudConfig();
        if (config.mode === "local") {
          return { content: [{ type: "text", text: "Error: cloud mode not configured." }], isError: true };
        }

        if (dry_run) {
          return { content: [{ type: "text", text: PG_MIGRATIONS.join("\n\n---\n\n") }] };
        }

        const pg = new PgAdapterAsync(getConnectionString("conversations"));
        const lines: string[] = [];
        for (let i = 0; i < PG_MIGRATIONS.length; i++) {
          await pg.run(PG_MIGRATIONS[i]);
          lines.push(`Migration ${i + 1}/${PG_MIGRATIONS.length}: applied`);
        }
        await pg.close();
        lines.push("All migrations applied successfully.");
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text", text: formatError(e) }], isError: true };
      }
    },
  );

  server.tool(
    "conversations_cloud_feedback",
    "Send feedback for the conversations service",
    {
      message: z.string().describe("Feedback message"),
      email: z.string().optional().describe("Contact email"),
    },
    async ({ message, email }) => {
      try {
        const { sendFeedback, createDatabase } = await import("@hasna/cloud");
        const db = createDatabase({ service: "cloud" });
        const result = await sendFeedback({ service: "conversations", message, email }, db);
        db.close();

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

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
