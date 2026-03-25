import { Command } from "commander";
import chalk from "chalk";
import {
  registerCloudCommands,
  incrementalSyncPush,
  incrementalSyncPull,
  SqliteAdapter,
  PgAdapter,
  PgAdapterAsync,
  getConnectionString,
  getDbPath,
  listSqliteTables,
  listPgTables,
  getSyncMetaAll,
} from "@hasna/cloud";

export function registerCommands(program: Command): void {
  registerCloudCommands(program as any, "connectors");

  // Add incremental sync subcommands to the cloud command
  // registerCloudCommands uses full syncPush/syncPull — these add delta sync as default
  const cloudCmd = program.commands.find((c) => c.name() === "cloud");
  if (cloudCmd) {
    const syncCmd = cloudCmd.command("sync").description("Incremental (delta) sync — only rows changed since last sync");

    syncCmd
      .command("push")
      .description("Push local changes to cloud (incremental by default)")
      .option("--tables <tables>", "Comma-separated table names")
      .option("--full", "Full resync instead of incremental delta", false)
      .action(async (opts: { tables?: string; full: boolean }) => {
        const local = new SqliteAdapter(getDbPath("connectors"));
        const tables = opts.tables ? opts.tables.split(",").map((t: string) => t.trim()) : listSqliteTables(local);
        if (opts.full) {
          const cloud = new PgAdapterAsync(getConnectionString("connectors"));
          const { syncPush } = await import("@hasna/cloud");
          const results = await syncPush(local, cloud, {
            tables,
            onProgress: (p: { phase: string; table: string; rowsWritten: number }) => {
              if (p.phase === "done") console.log(`  ${p.table}: ${p.rowsWritten} rows pushed (full)`);
            },
          });
          local.close();
          await cloud.close();
          const total = results.reduce((s: number, r: { rowsWritten: number }) => s + r.rowsWritten, 0);
          console.log(`Done. ${total} rows pushed (full sync).`);
        } else {
          const cloud = new PgAdapter(getConnectionString("connectors"));
          const results = incrementalSyncPush(local, cloud, tables);
          local.close();
          cloud.close();
          const total = results.reduce((s, r) => s + r.synced_rows, 0);
          const firstSync = results.filter((r) => r.first_sync).length;
          console.log(`Done. ${total} rows pushed (incremental).${firstSync ? ` ${firstSync} table(s) had first-sync.` : ""}`);
          for (const r of results) {
            if (r.errors.length) console.warn(`  ${r.table}: ${r.errors.join(", ")}`);
          }
        }
      });

    syncCmd
      .command("pull")
      .description("Pull cloud changes to local (incremental by default)")
      .option("--tables <tables>", "Comma-separated table names")
      .option("--full", "Full resync instead of incremental delta", false)
      .action(async (opts: { tables?: string; full: boolean }) => {
        const local = new SqliteAdapter(getDbPath("connectors"));
        if (opts.full) {
          const cloud = new PgAdapterAsync(getConnectionString("connectors"));
          const tables = opts.tables ? opts.tables.split(",").map((t: string) => t.trim()) : await listPgTables(cloud);
          const { syncPull } = await import("@hasna/cloud");
          const results = await syncPull(cloud, local, {
            tables,
            onProgress: (p: { phase: string; table: string; rowsWritten: number }) => {
              if (p.phase === "done") console.log(`  ${p.table}: ${p.rowsWritten} rows pulled (full)`);
            },
          });
          local.close();
          await cloud.close();
          const total = results.reduce((s: number, r: { rowsWritten: number }) => s + r.rowsWritten, 0);
          console.log(`Done. ${total} rows pulled (full sync).`);
        } else {
          const cloud = new PgAdapter(getConnectionString("connectors"));
          const tables = opts.tables ? opts.tables.split(",").map((t: string) => t.trim()) : listSqliteTables(local);
          const results = incrementalSyncPull(cloud, local, tables);
          local.close();
          cloud.close();
          const total = results.reduce((s, r) => s + r.synced_rows, 0);
          console.log(`Done. ${total} rows pulled (incremental).`);
          for (const r of results) {
            if (r.errors.length) console.warn(`  ${r.table}: ${r.errors.join(", ")}`);
          }
        }
      });

    syncCmd
      .command("status")
      .description("Show last-synced timestamps per table")
      .action(() => {
        const local = new SqliteAdapter(getDbPath("connectors"));
        const meta = getSyncMetaAll(local);
        local.close();
        if (!meta.length) {
          console.log("No sync history found. Run: connectors cloud sync push");
          return;
        }
        console.log(chalk.bold("\nSync status:\n"));
        for (const m of meta) {
          console.log(`  ${chalk.cyan(m.table_name.padEnd(32))} last synced: ${m.last_synced_at ?? "never"} (${m.direction})`);
        }
        console.log();
      });
  }
}
