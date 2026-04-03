import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase, now } from "../../db/database.js";
import { getMachineId } from "../../db/machines.js";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

/** Tables that have updated_at for conflict detection */
const CONFLICT_TABLES = new Set([
  "projects", "tasks", "agents", "task_lists", "plans", "orgs",
  "task_templates", "webhooks", "project_sources", "task_checklists",
]);

/**
 * Detect conflicts between local SQLite rows and remote PG rows for a table.
 * Returns the count of conflicts found and stores them via @hasna/cloud.
 */
async function detectAndLogConflicts(
  local: any, // SqliteAdapter
  cloud: any, // PgAdapterAsync
  table: string,
): Promise<number> {
  if (!CONFLICT_TABLES.has(table)) return 0;

  try {
    const { detectConflicts, storeConflicts } = await import("@hasna/cloud");
    const localRows = local.all(`SELECT * FROM "${table}"`);
    const remoteRows = await cloud.all(`SELECT * FROM "${table}"`);

    if (localRows.length === 0 || remoteRows.length === 0) return 0;

    const conflicts = detectConflicts(localRows, remoteRows, table, "id", "updated_at");
    if (conflicts.length > 0) {
      storeConflicts(local, conflicts);
    }
    return conflicts.length;
  } catch {
    return 0;
  }
}

/**
 * Register enhanced cloud sync tools that stamp machine_id and synced_at.
 * Replaces the generic @hasna/cloud registerCloudTools.
 */
export function registerCloudSyncTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("todos_cloud_status")) {
    server.tool(
      "todos_cloud_status",
      "Show cloud configuration, connection health, and local machine info",
      {},
      async () => {
        try {
          const { getCloudConfig, getConnectionString, PgAdapterAsync, listConflicts, ensureConflictsTable, SqliteAdapter, getDbPath } = await import("@hasna/cloud");
          const config = getCloudConfig();
          const db = getDatabase();
          const machineId = getMachineId(db);

          const lines = [
            `Mode: ${config.mode}`,
            `Service: todos`,
            `Machine ID: ${machineId}`,
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
            const local = new SqliteAdapter(getDbPath("todos"));
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
  }

  if (shouldRegisterTool("todos_cloud_push")) {
    server.tool(
      "todos_cloud_push",
      "Push local data to cloud PostgreSQL. Stamps machine_id on all rows, detects conflicts, and sets synced_at after successful push.",
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
            getDbPath,
          } = await import("@hasna/cloud");

          const config = getCloudConfig();
          if (config.mode === "local") {
            return { content: [{ type: "text", text: "Error: cloud mode not configured." }], isError: true };
          }

          const db = getDatabase();
          const machineId = getMachineId(db);
          const localPath = getDbPath("todos");
          const local = new SqliteAdapter(localPath);
          const cloud = new PgAdapterAsync(getConnectionString("todos"));

          const tableList = tablesStr
            ? tablesStr.split(",").map((t: string) => t.trim())
            : listSqliteTables(local).filter((t: string) => !t.startsWith("_"));

          // Stamp machine_id on all rows that don't have one
          for (const table of tableList) {
            try {
              local.run(`UPDATE "${table}" SET machine_id = ? WHERE machine_id IS NULL`, machineId);
            } catch {
              // Table may not have machine_id column — skip
            }
          }

          // Detect conflicts before pushing
          let totalConflicts = 0;
          for (const table of tableList) {
            totalConflicts += await detectAndLogConflicts(local, cloud, table);
          }

          const results = await syncPush(local, cloud, { tables: tableList });

          // Mark synced_at on successfully pushed rows
          const syncTime = now();
          for (const result of results) {
            if (result.rowsWritten > 0) {
              try {
                local.run(`UPDATE "${result.table}" SET synced_at = ? WHERE machine_id = ?`, syncTime, machineId);
              } catch {
                // Table may not have synced_at column
              }
            }
          }

          local.close();
          await cloud.close();

          const total = results.reduce((s: number, r: any) => s + r.rowsWritten, 0);
          const errors = results.flatMap((r: any) => r.errors);
          const lines = [`Pushed ${total} rows across ${tableList.length} table(s).`, `Machine: ${machineId}`];
          if (totalConflicts > 0) lines.push(`Conflicts detected: ${totalConflicts} (logged to _sync_conflicts)`);
          if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);

          return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text", text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("todos_cloud_pull")) {
    server.tool(
      "todos_cloud_pull",
      "Pull cloud PostgreSQL data to local. Detects conflicts, merges by primary key with UPSERT, and logs conflict resolutions.",
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
            getDbPath,
          } = await import("@hasna/cloud");

          const config = getCloudConfig();
          if (config.mode === "local") {
            return { content: [{ type: "text", text: "Error: cloud mode not configured." }], isError: true };
          }

          const local = new SqliteAdapter(getDbPath("todos"));
          const cloud = new PgAdapterAsync(getConnectionString("todos"));

          let tableList: string[];
          if (tablesStr) {
            tableList = tablesStr.split(",").map((t: string) => t.trim());
          } else {
            try {
              tableList = (await listPgTables(cloud)).filter((t: string) => !t.startsWith("_"));
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

          // Mark synced_at on pulled rows
          const syncTime = now();
          for (const result of results) {
            if (result.rowsWritten > 0) {
              try {
                local.run(`UPDATE "${result.table}" SET synced_at = ? WHERE synced_at IS NULL OR synced_at < ?`, syncTime, syncTime);
              } catch {
                // Table may not have synced_at column
              }
            }
          }

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
  }

  if (shouldRegisterTool("sync_all")) {
    server.tool(
      "sync_all",
      "Bidirectional cloud sync — pull remote changes then push local changes. Detects and logs conflicts.",
      {
        tables: z.string().optional().describe("Comma-separated table names (default: all)"),
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
            getDbPath,
          } = await import("@hasna/cloud");

          const config = getCloudConfig();
          if (config.mode === "local") {
            return { content: [{ type: "text", text: "Error: cloud mode not configured." }], isError: true };
          }

          const db = getDatabase();
          const machineId = getMachineId(db);
          const local = new SqliteAdapter(getDbPath("todos"));
          const cloud = new PgAdapterAsync(getConnectionString("todos"));

          // Determine tables — union of local and remote
          let tableList: string[];
          if (tablesStr) {
            tableList = tablesStr.split(",").map((t: string) => t.trim());
          } else {
            const localTables = new Set(listSqliteTables(local).filter((t: string) => !t.startsWith("_")));
            const remoteTables = new Set((await listPgTables(cloud)).filter((t: string) => !t.startsWith("_")));
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

          // Step 2: Stamp machine_id on local rows
          for (const table of tableList) {
            try { local.run(`UPDATE "${table}" SET machine_id = ? WHERE machine_id IS NULL`, machineId); } catch {}
          }

          // Step 3: Push local → remote
          const pushResults = await syncPush(local, cloud, { tables: tableList });
          const pushTotal = pushResults.reduce((s: number, r: any) => s + r.rowsWritten, 0);

          // Mark synced_at
          const syncTime = now();
          for (const table of tableList) {
            try { local.run(`UPDATE "${table}" SET synced_at = ?`, syncTime); } catch {}
          }

          local.close();
          await cloud.close();

          const allErrors = [
            ...pullResults.flatMap((r: any) => r.errors.map((e: string) => `pull: ${e}`)),
            ...pushResults.flatMap((r: any) => r.errors.map((e: string) => `push: ${e}`)),
          ];

          const lines = [
            `Sync complete: pulled ${pullTotal} rows, pushed ${pushTotal} rows across ${tableList.length} table(s).`,
            `Machine: ${machineId}`,
          ];
          if (totalConflicts > 0) lines.push(`Conflicts detected: ${totalConflicts} (logged to _sync_conflicts)`);
          if (allErrors.length > 0) lines.push(`Errors: ${allErrors.join("; ")}`);

          return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text", text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("todos_cloud_conflicts")) {
    server.tool(
      "todos_cloud_conflicts",
      "List sync conflicts detected during push/pull operations. Shows unresolved conflicts by default.",
      {
        resolved: z.boolean().optional().describe("Filter by resolved status. Default: false (unresolved only)"),
        table: z.string().optional().describe("Filter by table name"),
        limit: z.number().optional().describe("Max conflicts to return. Default: 20"),
      },
      async ({ resolved, table, limit: maxResults }) => {
        try {
          const { listConflicts, ensureConflictsTable, SqliteAdapter, getDbPath } = await import("@hasna/cloud");

          const local = new SqliteAdapter(getDbPath("todos"));
          ensureConflictsTable(local);

          const conflicts = listConflicts(local, {
            resolved: resolved ?? false,
            table: table,
          });
          local.close();

          const shown = conflicts.slice(0, maxResults ?? 20);
          if (shown.length === 0) {
            return { content: [{ type: "text", text: resolved ? "No resolved conflicts." : "No unresolved conflicts." }] };
          }

          const lines = [`${conflicts.length} conflict(s) found${conflicts.length > shown.length ? ` (showing ${shown.length})` : ""}:\n`];
          for (const c of shown) {
            lines.push(`[${c.id}] ${c.table_name}/${c.row_id}`);
            lines.push(`  Local updated: ${c.local_updated_at}`);
            lines.push(`  Remote updated: ${c.remote_updated_at}`);
            if (c.resolution) lines.push(`  Resolution: ${c.resolution} at ${c.resolved_at}`);
            lines.push("");
          }

          return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text", text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("todos_cloud_feedback")) {
    server.tool(
      "todos_cloud_feedback",
      "Send feedback for this service",
      {
        message: z.string().describe("Feedback message"),
        email: z.string().optional().describe("Contact email"),
      },
      async ({ message, email }) => {
        try {
          const { sendFeedback, createDatabase } = await import("@hasna/cloud");
          const db = createDatabase({ service: "cloud" });
          const result = await sendFeedback({ service: "todos", message, email }, db);
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
}
