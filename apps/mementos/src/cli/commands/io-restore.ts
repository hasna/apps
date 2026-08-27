import type { Command } from "commander";
import chalk from "chalk";
import { join, resolve } from "node:path";
import { existsSync, statSync, copyFileSync, readdirSync } from "node:fs";
import { getDatabase, getDbPath, resetDatabase } from "../../db/database.js";
import { isApiMode } from "../../db/api-mode.js";
import { bulkUpsertMemories } from "../../db/memories.js";
import { getDataRoot } from "../../lib/paths.js";
import {
  outputJson,
  makeHandleError,
  type GlobalOpts,
} from "../helpers.js";

/**
 * Read every row of a backup file's `memories` table.
 *
 * The backup file is a copy of the live SQLite database (`mementos backup`),
 * so the `memories` table is the full row set. Rows are passed through
 * unchanged: the bulk-restore path (local and hosted) validates enums,
 * redacts secrets and preserves original ids and status.
 */
function readMemoriesFromBackup(source: string): {
  rows: Array<Record<string, unknown>>;
  count: number;
} {
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  const backupDb = new Database(source, { readonly: true });
  try {
    const rows = backupDb
      .query("SELECT * FROM memories")
      .all() as Array<Record<string, unknown>>;
    return { rows, count: rows.length };
  } finally {
    backupDb.close();
  }
}

export function registerRestoreCommand(program: Command): void {
  const handleError = makeHandleError(program);

  program
    .command("restore [file]")
    .description("Restore the database from a backup file")
    .option("--latest", "Restore the most recent backup from the mementos backups dir")
    .option("--force", "Skip confirmation and perform the restore")
    .action((filePath: string | undefined, opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const backupsDir = join(getDataRoot(), "backups");

        let source: string;

        if (opts.latest) {
          if (!existsSync(backupsDir)) {
            console.error(chalk.red("No backups directory found."));
            process.exit(1);
          }
          const files = readdirSync(backupsDir)
            .filter((f: string) => f.endsWith(".db"))
            .map((f: string) => {
              const fp = resolve(backupsDir, f);
              const st = statSync(fp);
              return { path: fp, mtime: st.mtime };
            })
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

          if (files.length === 0) {
            console.error(chalk.red("No backups found in " + backupsDir));
            process.exit(1);
          }
          source = files[0]!.path;
        } else if (filePath) {
          source = resolve(filePath);
        } else {
          console.error(chalk.red("Provide a backup file path or use --latest"));
          process.exit(1);
        }

        if (!existsSync(source)) {
          console.error(chalk.red(`Backup file not found: ${source}`));
          process.exit(1);
        }

        const backupStat = statSync(source);
        const backupSizeMB = (backupStat.size / (1024 * 1024)).toFixed(1);
        const backupSizeStr = backupStat.size >= 1024 * 1024 ? `${backupSizeMB} MB` : `${(backupStat.size / 1024).toFixed(1)} KB`;

        // Hosted path: the store is the cloud (no client-side db file), so a
        // restore re-ships the backup's memories into it through the faithful
        // idempotent bulk-restore primitive (original ids and status
        // preserved; existing store rows are NEVER overwritten). Replacing the
        // shared store wholesale from one machine's backup would destroy other
        // machines' memories with no preserved original.
        if (isApiMode()) {
          const { rows, count } = readMemoriesFromBackup(source);

          if (!opts.force) {
            if (globalOpts.json) {
              outputJson({
                action: "restore",
                source,
                target: "cloud-api",
                backup_size: backupStat.size,
                backup_memories: count,
                status: "dry_run",
                message:
                  "Restores the backup's memories into the hosted store; existing store rows are never overwritten. Use --force to confirm.",
              });
              return;
            }
            console.log(chalk.bold("Restore preview (hosted store):"));
            console.log(`  Source:           ${chalk.cyan(source)} (${backupSizeStr})`);
            console.log(`  Backup memories:  ${chalk.green(String(count))}`);
            console.log(`  Target:           hosted store (cloud-api)`);
            console.log(`  Semantics:        merges the backup's memories; existing rows are never overwritten`);
            console.log();
            console.log(chalk.yellow("Use --force to confirm restore"));
            return;
          }

          const result = bulkUpsertMemories(rows);

          // Fail closed: rows the store refused did not persist, so the
          // command must not read as a completed restore. (A current server
          // returns 400 for rejections and apiJson throws; this guard also
          // covers a server contract that drifts toward 2xx-with-rejections.)
          if (result.rejected > 0) {
            const msg = `${result.rejected} of ${result.total} memories were rejected and did not persist. See errors.`;
            if (globalOpts.json) {
              outputJson({
                action: "restore",
                status: "failed",
                source,
                target: "cloud-api",
                inserted: result.inserted,
                skipped: result.skipped,
                rejected: result.rejected,
                total: result.total,
                error: msg,
              });
            } else {
              console.error(chalk.red(msg));
            }
            process.exit(1);
          }

          if (globalOpts.json) {
            outputJson({
              action: "restore",
              source,
              target: "cloud-api",
              backup_size: backupStat.size,
              backup_memories: count,
              restored_memories: result.inserted,
              inserted: result.inserted,
              skipped: result.skipped,
              rejected: result.rejected,
              total: result.total,
              status: "completed",
            });
            return;
          }

          console.log(`Restored from: ${chalk.green(source)}`);
          console.log(`  Restored memories: ${chalk.green(String(result.inserted))} (inserted)`);
          console.log(`  Skipped (already present): ${chalk.yellow(String(result.skipped))}`);
          console.log(`  Rejected: ${chalk.yellow(String(result.rejected))}`);
          return;
        }

        // Local path: `restore` copies a backup file over the LOCAL SQLite
        // database. The cloud store has no client-side db file, which is why
        // API mode takes the branch above instead of reaching this code.
        const dbPath = getDbPath();

        // Get current DB memory count
        let currentCount = 0;
        if (existsSync(dbPath)) {
          try {
            const db = getDatabase();
            const row = db.query("SELECT COUNT(*) as count FROM memories").get() as { count: number } | null;
            currentCount = row?.count ?? 0;
          } catch {
            // DB might be corrupted, that's ok
          }
        }

        // Get backup memory count by opening it temporarily
        let backupCount = 0;
        try {
          const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
          const backupDb = new Database(source, { readonly: true });
          const row = backupDb.query("SELECT COUNT(*) as count FROM memories").get() as { count: number } | null;
          backupCount = row?.count ?? 0;
          backupDb.close();
        } catch {
          // Can't read backup stats, that's ok
        }

        if (!opts.force) {
          if (globalOpts.json) {
            outputJson({
              action: "restore",
              source,
              target: dbPath,
              backup_size: backupStat.size,
              current_memories: currentCount,
              backup_memories: backupCount,
              status: "dry_run",
              message: "Use --force to confirm restore",
            });
            return;
          }
          console.log(chalk.bold("Restore preview:"));
          console.log(`  Source:           ${chalk.cyan(source)} (${backupSizeStr})`);
          console.log(`  Target:           ${chalk.cyan(dbPath)}`);
          console.log(`  Current memories: ${chalk.yellow(String(currentCount))}`);
          console.log(`  Backup memories:  ${chalk.green(String(backupCount))}`);
          console.log();
          console.log(chalk.yellow("Use --force to confirm restore"));
          return;
        }

        // Perform the restore
        copyFileSync(source, dbPath);

        // Verify restored DB
        let newCount = 0;
        try {
          // Reset the singleton so getDatabase re-opens
          resetDatabase();
          const db = getDatabase();
          const row = db.query("SELECT COUNT(*) as count FROM memories").get() as { count: number } | null;
          newCount = row?.count ?? 0;
        } catch {
          // Just report what we can
        }

        if (globalOpts.json) {
          outputJson({
            action: "restore",
            source,
            target: dbPath,
            previous_memories: currentCount,
            restored_memories: newCount,
            status: "completed",
          });
          return;
        }

        console.log(`Restored from: ${chalk.green(source)}`);
        console.log(`  Previous memories: ${chalk.yellow(String(currentCount))}`);
        console.log(`  Restored memories: ${chalk.green(String(newCount))}`);
      } catch (e) {
        handleError(e);
      }
    });
}
