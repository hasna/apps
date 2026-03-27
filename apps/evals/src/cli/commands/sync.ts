import { Command } from "commander";

export function syncCommand(): Command {
  const cmd = new Command("sync")
    .description("Sync eval runs and datasets with cloud");

  cmd
    .command("push")
    .description("Push local runs and datasets to cloud")
    .option("--dry-run", "Show what would be pushed without doing it")
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const { syncPush } = await import("@hasna/cloud");
        void await import("../../db/store.js"); // ensure DB initialized

        if (opts.dryRun) {
          console.log("Dry run — would push evals database to cloud.");
          return;
        }

        console.log("Pushing to cloud...");
        const { SqliteAdapter, PgAdapterAsync, getConnectionString, getDbPath } = await import("@hasna/cloud");
        const connStr = getConnectionString("evals");
        const dbPath = getDbPath("evals");
        const local = new SqliteAdapter(dbPath);
        const remote = new PgAdapterAsync(connStr);
        const results = await syncPush(local, remote, { tables: ["runs", "baselines"] });
        const total = results.reduce((s, r) => s + r.rowsWritten, 0);
        console.log(`\x1b[32m✓ Pushed ${total} rows\x1b[0m`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" ||
            String(err).includes("not found")) {
          console.error("Cloud sync requires @hasna/cloud. Run: bun install");
        } else {
          console.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exit(1);
      }
    });

  cmd
    .command("pull")
    .description("Pull runs and datasets from cloud")
    .option("--dry-run", "Show what would be pulled without doing it")
    .action(async (opts: { dryRun?: boolean }) => {
      try {
        const { syncPull } = await import("@hasna/cloud");
        void await import("../../db/store.js"); // ensure DB initialized

        if (opts.dryRun) {
          console.log("Dry run — would pull evals data from cloud.");
          return;
        }

        console.log("Pulling from cloud...");
        const { SqliteAdapter, PgAdapterAsync, getConnectionString, getDbPath } = await import("@hasna/cloud");
        const connStr = getConnectionString("evals");
        const dbPath = getDbPath("evals");
        const local = new SqliteAdapter(dbPath);
        const remote = new PgAdapterAsync(connStr);
        const results = await syncPull(remote, local, { tables: ["runs", "baselines"] });
        const total = results.reduce((s, r) => s + r.rowsWritten, 0);
        console.log(`\x1b[32m✓ Pulled ${total} rows\x1b[0m`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" ||
            String(err).includes("not found")) {
          console.error("Cloud sync requires @hasna/cloud. Run: bun install");
        } else {
          console.error(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exit(1);
      }
    });

  cmd
    .command("status")
    .description("Show cloud sync status")
    .action(async () => {
      try {
        const { getCloudConfig } = await import("@hasna/cloud");
        const config = await getCloudConfig();
        if (!config) {
          console.log("Cloud sync not configured. Run: evals sync push");
          return;
        }
        console.log(`\x1b[32m✓ Cloud sync configured\x1b[0m`);
        console.log(`  Service: evals`);
      } catch {
        console.log("Cloud sync not configured.");
      }
    });

  return cmd;
}
