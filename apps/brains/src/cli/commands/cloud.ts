import type { Command } from "commander";
import { printError, printSuccess, printInfo } from "../ui.js";

export function registerCloudCommands(program: Command): void {
  const cloudCmd = program.command("cloud").description("Cloud sync commands");

  cloudCmd
    .command("status")
    .description("Show cloud config and connection health")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const { getCloudConfig, getConnectionString, PgAdapterAsync, SqliteAdapter, getDbPath, listSqliteTables, ensureConflictsTable, listConflicts } = await import("@hasna/cloud");
        const config = getCloudConfig();
        const info: Record<string, unknown> = {
          mode: config.mode,
          service: "brains",
          rds_host: config.rds?.host || "(not configured)",
        };

        if (config.rds?.host && config.rds?.username) {
          try {
            const pg = new PgAdapterAsync(getConnectionString("postgres"));
            await pg.get("SELECT 1 as ok");
            info.postgresql = "connected";
            await pg.close();
          } catch (err) {
            info.postgresql = `failed — ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        const local = new SqliteAdapter(getDbPath("brains"));
        const tables = listSqliteTables(local).filter((t: string) => !t.startsWith("_"));
        const syncHealth: Array<{ table: string; total: number; unsynced: number }> = [];
        for (const table of tables) {
          try {
            const totalRow = local.get(`SELECT COUNT(*) as c FROM "${table}"`) as { c: number } | null;
            const unsyncedRow = local.get(`SELECT COUNT(*) as c FROM "${table}" WHERE synced_at IS NULL`) as { c: number } | null;
            syncHealth.push({ table, total: totalRow?.c ?? 0, unsynced: unsyncedRow?.c ?? 0 });
          } catch { /* table may lack synced_at */ }
        }
        info.sync_health = syncHealth.filter((s) => s.total > 0);

        try {
          ensureConflictsTable(local);
          const unresolved = listConflicts(local, { resolved: false });
          info.conflicts_unresolved = unresolved.length;
        } catch { /* ignore */ }
        local.close();

        if (opts.json) { console.log(JSON.stringify(info, null, 2)); return; }

        printInfo(`Mode: ${info.mode}`);
        printInfo(`RDS Host: ${info.rds_host}`);
        if (info.postgresql) printInfo(`PostgreSQL: ${info.postgresql}`);
        for (const s of (info.sync_health as typeof syncHealth)) {
          const pct = s.total > 0 ? Math.round(((s.total - s.unsynced) / s.total) * 100) : 100;
          printInfo(`  ${s.table}: ${pct}% synced (${s.unsynced} unsynced / ${s.total} total)`);
        }
        if (info.conflicts_unresolved) printInfo(`Conflicts: ${info.conflicts_unresolved} unresolved`);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  cloudCmd
    .command("push")
    .description("Push local data to cloud PostgreSQL")
    .option("--tables <tables>", "Comma-separated table names (default: all)")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      try {
        const { getCloudConfig, getConnectionString, syncPush, listSqliteTables, SqliteAdapter, PgAdapterAsync, getDbPath } = await import("@hasna/cloud");
        const config = getCloudConfig();
        if (config.mode === "local") { printError("Cloud mode not configured."); process.exit(1); }

        const local = new SqliteAdapter(getDbPath("brains"));
        const cloud = new PgAdapterAsync(getConnectionString("brains"));
        const tableList = opts.tables
          ? opts.tables.split(",").map((t) => t.trim())
          : listSqliteTables(local).filter((t: string) => !t.startsWith("_"));

        const results = await syncPush(local, cloud, {
          tables: tableList,
          onProgress: (p: { phase: string; table: string; rowsWritten: number }) => {
            if (!opts.json && p.phase === "done") printInfo(`  ${p.table}: ${p.rowsWritten} rows pushed`);
          },
        });

        local.close();
        await cloud.close();
        const total = results.reduce((s: number, r: { rowsWritten: number }) => s + r.rowsWritten, 0);
        if (opts.json) { console.log(JSON.stringify({ total, tables: results })); return; }
        printSuccess(`Done. ${total} rows pushed.`);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  cloudCmd
    .command("pull")
    .description("Pull cloud data to local — merges by primary key")
    .option("--tables <tables>", "Comma-separated table names (default: all)")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      try {
        const { getCloudConfig, getConnectionString, syncPull, listPgTables, SqliteAdapter, PgAdapterAsync, getDbPath } = await import("@hasna/cloud");
        const config = getCloudConfig();
        if (config.mode === "local") { printError("Cloud mode not configured."); process.exit(1); }

        const local = new SqliteAdapter(getDbPath("brains"));
        const cloud = new PgAdapterAsync(getConnectionString("brains"));
        const tableList = opts.tables
          ? opts.tables.split(",").map((t) => t.trim())
          : (await listPgTables(cloud)).filter((t: string) => !t.startsWith("_"));

        const results = await syncPull(cloud, local, {
          tables: tableList,
          onProgress: (p: { phase: string; table: string; rowsWritten: number }) => {
            if (!opts.json && p.phase === "done") printInfo(`  ${p.table}: ${p.rowsWritten} rows pulled`);
          },
        });

        local.close();
        await cloud.close();
        const total = results.reduce((s: number, r: { rowsWritten: number }) => s + r.rowsWritten, 0);
        if (opts.json) { console.log(JSON.stringify({ total, tables: results })); return; }
        printSuccess(`Done. ${total} rows pulled.`);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  cloudCmd
    .command("sync")
    .description("Bidirectional sync — pull then push")
    .option("--tables <tables>", "Comma-separated table names (default: all)")
    .option("--json", "Output as JSON")
    .action(async (opts: { tables?: string; json?: boolean }) => {
      try {
        const { getCloudConfig, getConnectionString, syncPush, syncPull, listSqliteTables, listPgTables, SqliteAdapter, PgAdapterAsync, getDbPath } = await import("@hasna/cloud");
        const config = getCloudConfig();
        if (config.mode === "local") { printError("Cloud mode not configured."); process.exit(1); }

        const local = new SqliteAdapter(getDbPath("brains"));
        const cloud = new PgAdapterAsync(getConnectionString("brains"));

        const localTables = listSqliteTables(local).filter((t: string) => !t.startsWith("_"));
        const remoteTables = (await listPgTables(cloud)).filter((t: string) => !t.startsWith("_"));
        const tableList = opts.tables
          ? opts.tables.split(",").map((t) => t.trim())
          : [...new Set([...localTables, ...remoteTables])];

        const pullResults = await syncPull(cloud, local, { tables: tableList.filter((t) => remoteTables.includes(t)) });
        const pushResults = await syncPush(local, cloud, { tables: tableList.filter((t) => localTables.includes(t)) });

        local.close();
        await cloud.close();
        const pulled = pullResults.reduce((s: number, r: { rowsWritten: number }) => s + r.rowsWritten, 0);
        const pushed = pushResults.reduce((s: number, r: { rowsWritten: number }) => s + r.rowsWritten, 0);
        if (opts.json) { console.log(JSON.stringify({ pulled, pushed })); return; }
        printSuccess(`Sync done. Pulled ${pulled} rows, pushed ${pushed} rows.`);
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });

  cloudCmd
    .command("migrate-pg")
    .description("Apply PostgreSQL migrations to the cloud database")
    .requiredOption("--connection-string <connStr>", "PostgreSQL connection string")
    .option("--json", "Output as JSON")
    .action(async (opts: { connectionString: string; json?: boolean }) => {
      try {
        const { applyPgMigrations } = await import("../../db/pg-migrate.js");
        const result = await applyPgMigrations(opts.connectionString);
        if (opts.json) { console.log(JSON.stringify(result)); return; }
        printSuccess(`Applied ${result.applied.length} migration(s), skipped ${result.alreadyApplied.length}.`);
        if (result.errors.length > 0) { printError(result.errors.join("\n")); process.exit(1); }
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}
