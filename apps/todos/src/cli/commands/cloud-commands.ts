import type { Command } from "commander";
import chalk from "chalk";

export function registerCloudCommands(program: Command) {
  // cloud
  const cloudCmd = program
    .command("cloud")
    .description("Cloud sync commands");

  cloudCmd
    .command("status")
    .description("Show cloud config, connection health, machine registry, and sync status")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const { getCloudConfig, getConnectionString, PgAdapterAsync, SqliteAdapter, getDbPath, listSqliteTables, ensureConflictsTable, listConflicts } = await import("@hasna/cloud");
        const { getMachineId, listMachines } = await import("../../db/machines.js");
        const config = getCloudConfig();
        const machineId = getMachineId();
        const machines = listMachines();

        const info: Record<string, any> = {
          mode: config.mode,
          service: "todos",
          machine_id: machineId,
          rds_host: config.rds.host || "(not configured)",
          machines: machines.map(m => ({ id: m.id, name: m.name, hostname: m.hostname, platform: m.platform, last_seen: m.last_seen_at })),
        };

        // Check PG connection
        if (config.rds.host && config.rds.username) {
          try {
            const pg = new PgAdapterAsync(getConnectionString("postgres"));
            await pg.get("SELECT 1 as ok");
            info.postgresql = "connected";
            await pg.close();
          } catch (err: any) {
            info.postgresql = `failed — ${err?.message}`;
          }
        }

        // Sync health: per-table counts of unsynced rows
        const local = new SqliteAdapter(getDbPath("todos"));
        const tables = listSqliteTables(local).filter((t: string) => !t.startsWith("_"));
        const syncHealth: Array<{ table: string; total: number; unsynced: number; last_synced: string | null }> = [];
        for (const table of tables) {
          try {
            const totalRow = local.get(`SELECT COUNT(*) as c FROM "${table}"`) as { c: number } | null;
            const unsyncedRow = local.get(`SELECT COUNT(*) as c FROM "${table}" WHERE synced_at IS NULL`) as { c: number } | null;
            const lastRow = local.get(`SELECT MAX(synced_at) as m FROM "${table}"`) as { m: string | null } | null;
            syncHealth.push({
              table,
              total: totalRow?.c ?? 0,
              unsynced: unsyncedRow?.c ?? 0,
              last_synced: lastRow?.m ?? null,
            });
          } catch {
            // Table might not have synced_at
          }
        }
        info.sync_health = syncHealth.filter(s => s.total > 0);

        // Conflicts
        try {
          ensureConflictsTable(local);
          const unresolved = listConflicts(local, { resolved: false });
          info.conflicts_unresolved = unresolved.length;
        } catch {}

        local.close();

        if (useJson) {
          console.log(JSON.stringify(info, null, 2));
        } else {
          console.log(chalk.bold("Cloud Status"));
          console.log(`  Mode: ${info.mode}`);
          console.log(`  Machine: ${machineId}`);
          console.log(`  RDS Host: ${info.rds_host}`);
          if (info.postgresql) console.log(`  PostgreSQL: ${info.postgresql}`);

          if (machines.length > 0) {
            console.log(chalk.bold("\nMachines"));
            for (const m of machines) {
              const current = m.id === machineId ? chalk.green(" (this)") : "";
              console.log(`  ${m.name}${current} — ${m.hostname || "?"} / ${m.platform || "?"} — last seen ${m.last_seen_at}`);
            }
          }

          const healthItems = (info.sync_health as typeof syncHealth).filter(s => s.total > 0);
          if (healthItems.length > 0) {
            console.log(chalk.bold("\nSync Health"));
            for (const s of healthItems) {
              const pct = s.total > 0 ? Math.round(((s.total - s.unsynced) / s.total) * 100) : 100;
              const color = pct === 100 ? chalk.green : pct > 50 ? chalk.yellow : chalk.red;
              console.log(`  ${s.table}: ${color(`${pct}%`)} synced (${s.unsynced} unsynced / ${s.total} total)${s.last_synced ? ` — last: ${s.last_synced}` : ""}`);
            }
          }

          if (info.conflicts_unresolved > 0) {
            console.log(chalk.bold("\nConflicts"));
            console.log(`  ${chalk.yellow(`${info.conflicts_unresolved} unresolved`)} — run \`todos cloud conflicts\` to review`);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (useJson) {
          console.log(JSON.stringify({ error: msg }));
        } else {
          console.error(chalk.red(msg));
        }
      }
    });

  cloudCmd
    .command("push")
    .description("Push local data to cloud PostgreSQL")
    .option("--tables <tables>", "Comma-separated table names (default: all)")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const { getCloudConfig, getConnectionString, syncPush, listSqliteTables, SqliteAdapter, PgAdapterAsync, getDbPath } = await import("@hasna/cloud");
        const { getMachineId } = await import("../../db/machines.js");
        const { now } = await import("../../db/database.js");

        const config = getCloudConfig();
        if (config.mode === "local") {
          const msg = "Error: cloud mode not configured.";
          if (useJson) { console.log(JSON.stringify({ error: msg })); } else { console.error(chalk.red(msg)); }
          process.exit(1);
        }

        const machineId = getMachineId();
        const local = new SqliteAdapter(getDbPath("todos"));
        const cloud = new PgAdapterAsync(getConnectionString("todos"));

        const tableList = opts.tables
          ? opts.tables.split(",").map((t: string) => t.trim())
          : listSqliteTables(local).filter((t: string) => !t.startsWith("_"));

        // Stamp machine_id
        for (const table of tableList) {
          try { local.run(`UPDATE "${table}" SET machine_id = ? WHERE machine_id IS NULL`, machineId); } catch {}
        }

        const results = await syncPush(local, cloud, {
          tables: tableList,
          onProgress: (p: any) => {
            if (!useJson && p.phase === "done") {
              console.log(`  ${p.table}: ${p.rowsWritten} rows pushed`);
            }
          },
        });

        // Mark synced_at
        const syncTime = now();
        for (const r of results) {
          if (r.rowsWritten > 0) {
            try { local.run(`UPDATE "${r.table}" SET synced_at = ? WHERE machine_id = ?`, syncTime, machineId); } catch {}
          }
        }

        local.close();
        await cloud.close();

        const total = results.reduce((s: number, r: any) => s + r.rowsWritten, 0);
        if (useJson) {
          console.log(JSON.stringify({ total, machine_id: machineId, tables: results }));
        } else {
          console.log(chalk.green(`Done. ${total} rows pushed (machine: ${machineId}).`));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (useJson) { console.log(JSON.stringify({ error: msg })); } else { console.error(chalk.red(msg)); }
        process.exit(1);
      }
    });

  cloudCmd
    .command("pull")
    .description("Pull cloud data to local — merges by primary key")
    .option("--tables <tables>", "Comma-separated table names (default: all)")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const { getCloudConfig, getConnectionString, syncPull, listPgTables, SqliteAdapter, PgAdapterAsync, getDbPath } = await import("@hasna/cloud");
        const { now } = await import("../../db/database.js");

        const config = getCloudConfig();
        if (config.mode === "local") {
          const msg = "Error: cloud mode not configured.";
          if (useJson) { console.log(JSON.stringify({ error: msg })); } else { console.error(chalk.red(msg)); }
          process.exit(1);
        }

        const local = new SqliteAdapter(getDbPath("todos"));
        const cloud = new PgAdapterAsync(getConnectionString("todos"));

        let tableList: string[];
        if (opts.tables) {
          tableList = opts.tables.split(",").map((t: string) => t.trim());
        } else {
          tableList = (await listPgTables(cloud)).filter((t: string) => !t.startsWith("_"));
        }

        const results = await syncPull(cloud, local, {
          tables: tableList,
          onProgress: (p: any) => {
            if (!useJson && p.phase === "done") {
              console.log(`  ${p.table}: ${p.rowsWritten} rows pulled`);
            }
          },
        });

        // Mark synced_at
        const syncTime = now();
        for (const r of results) {
          if (r.rowsWritten > 0) {
            try { local.run(`UPDATE "${r.table}" SET synced_at = ? WHERE synced_at IS NULL OR synced_at < ?`, syncTime, syncTime); } catch {}
          }
        }

        local.close();
        await cloud.close();

        const total = results.reduce((s: number, r: any) => s + r.rowsWritten, 0);
        if (useJson) {
          console.log(JSON.stringify({ total, tables: results }));
        } else {
          console.log(chalk.green(`Done. ${total} rows pulled.`));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (useJson) { console.log(JSON.stringify({ error: msg })); } else { console.error(chalk.red(msg)); }
        process.exit(1);
      }
    });

  cloudCmd
    .command("sync")
    .description("Bidirectional sync — pull remote changes then push local changes")
    .option("--tables <tables>", "Comma-separated table names (default: all)")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const { getCloudConfig, getConnectionString, syncPush, syncPull, listSqliteTables, listPgTables, SqliteAdapter, PgAdapterAsync, getDbPath } = await import("@hasna/cloud");
        const { getMachineId } = await import("../../db/machines.js");
        const { now } = await import("../../db/database.js");

        const config = getCloudConfig();
        if (config.mode === "local") {
          const msg = "Error: cloud mode not configured.";
          if (useJson) { console.log(JSON.stringify({ error: msg })); } else { console.error(chalk.red(msg)); }
          process.exit(1);
        }

        const machineId = getMachineId();
        const local = new SqliteAdapter(getDbPath("todos"));
        const cloud = new PgAdapterAsync(getConnectionString("todos"));

        // Union of local + remote tables
        let tableList: string[];
        if (opts.tables) {
          tableList = opts.tables.split(",").map((t: string) => t.trim());
        } else {
          const localTables = new Set(listSqliteTables(local).filter((t: string) => !t.startsWith("_")));
          const remoteTables = new Set((await listPgTables(cloud)).filter((t: string) => !t.startsWith("_")));
          tableList = [...new Set([...localTables, ...remoteTables])];
        }

        // Pull first
        if (!useJson) console.log(chalk.bold("Pulling..."));
        const pullResults = await syncPull(cloud, local, {
          tables: tableList,
          onProgress: (p: any) => { if (!useJson && p.phase === "done" && p.rowsWritten > 0) console.log(`  ↓ ${p.table}: ${p.rowsWritten} rows`); },
        });
        const pullTotal = pullResults.reduce((s: number, r: any) => s + r.rowsWritten, 0);

        // Stamp machine_id
        for (const table of tableList) {
          try { local.run(`UPDATE "${table}" SET machine_id = ? WHERE machine_id IS NULL`, machineId); } catch {}
        }

        // Push
        if (!useJson) console.log(chalk.bold("Pushing..."));
        const pushResults = await syncPush(local, cloud, {
          tables: tableList,
          onProgress: (p: any) => { if (!useJson && p.phase === "done" && p.rowsWritten > 0) console.log(`  ↑ ${p.table}: ${p.rowsWritten} rows`); },
        });
        const pushTotal = pushResults.reduce((s: number, r: any) => s + r.rowsWritten, 0);

        // Mark synced_at
        const syncTime = now();
        for (const table of tableList) {
          try { local.run(`UPDATE "${table}" SET synced_at = ?`, syncTime); } catch {}
        }

        local.close();
        await cloud.close();

        if (useJson) {
          console.log(JSON.stringify({ pulled: pullTotal, pushed: pushTotal, machine_id: machineId, tables: tableList.length }));
        } else {
          console.log(chalk.green(`Done. Pulled ${pullTotal}, pushed ${pushTotal} rows across ${tableList.length} table(s) (machine: ${machineId}).`));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (useJson) { console.log(JSON.stringify({ error: msg })); } else { console.error(chalk.red(msg)); }
        process.exit(1);
      }
    });

  cloudCmd
    .command("conflicts")
    .description("List sync conflicts detected during push/pull")
    .option("--resolved", "Show resolved conflicts instead of unresolved")
    .option("--table <table>", "Filter by table name")
    .option("--limit <n>", "Max conflicts to show", "20")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const { listConflicts, ensureConflictsTable, SqliteAdapter, getDbPath } = await import("@hasna/cloud");
        const local = new SqliteAdapter(getDbPath("todos"));
        ensureConflictsTable(local);

        const conflicts = listConflicts(local, { resolved: !!opts.resolved, table: opts.table });
        local.close();

        const maxResults = parseInt(opts.limit, 10) || 20;
        const shown = conflicts.slice(0, maxResults);

        if (useJson) {
          console.log(JSON.stringify({ total: conflicts.length, conflicts: shown }, null, 2));
          return;
        }

        if (shown.length === 0) {
          console.log(chalk.dim(opts.resolved ? "No resolved conflicts." : "No unresolved conflicts."));
          return;
        }

        console.log(`${conflicts.length} conflict(s)${conflicts.length > shown.length ? ` (showing ${shown.length})` : ""}:\n`);
        for (const c of shown) {
          console.log(chalk.yellow(`[${c.id}]`) + ` ${c.table_name}/${c.row_id}`);
          console.log(`  Local:  ${c.local_updated_at}`);
          console.log(`  Remote: ${c.remote_updated_at}`);
          if (c.resolution) console.log(`  Resolution: ${chalk.green(c.resolution)} at ${c.resolved_at}`);
          console.log();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (useJson) { console.log(JSON.stringify({ error: msg })); } else { console.error(chalk.red(msg)); }
      }
    });
}
