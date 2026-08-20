import type { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { HASNA_HOME, dirExists, execSafe, formatBytes } from "../utils.js";

const BACKUP_DIR = join(HASNA_HOME, "backups");

function ensureBackupDir(): void {
  if (!dirExists(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function generateBackupName(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `hasna-backup-${ts}.tar.gz`;
}

export function registerBackupCommand(program: Command): void {
  const backupCmd = program.command("backup").description("Back up and restore ~/.hasna data");

  backupCmd
    .command("create")
    .alias("run")
    .description("Create a tarball backup of ~/.hasna (excluding backups dir)")
    .option("-o, --output <path>", "Output path for the backup file")
    .action((opts) => {
      if (!dirExists(HASNA_HOME)) {
        console.error(chalk.red("~/.hasna does not exist. Run 'hasna init' first."));
        process.exit(1);
      }
      ensureBackupDir();
      const filename = generateBackupName();
      const outputPath = opts.output ? resolve(opts.output) : join(BACKUP_DIR, filename);
      console.log(chalk.bold(`hasna backup create\n`));
      console.log(chalk.dim(`  Source: ${HASNA_HOME}`));
      console.log(chalk.dim(`  Output: ${outputPath}\n`));
      const result = execSafe(`tar -czf "${outputPath}" -C "${HASNA_HOME}" --exclude="backups" . 2>&1`, 120000);
      if (result !== null && existsSync(outputPath)) {
        const size = statSync(outputPath).size;
        console.log(chalk.green(`  Backup created: ${outputPath} (${formatBytes(size)})`));
      } else {
        console.error(chalk.red(`  Backup failed: ${result || "unknown error"}`));
        process.exit(1);
      }
    });

  backupCmd
    .command("restore <file>")
    .description("Restore a backup tarball into ~/.hasna")
    .option("--dry-run", "Show what would be restored without actually restoring")
    .action((file: string, opts) => {
      const filePath = resolve(file);
      if (!existsSync(filePath)) {
        console.error(chalk.red(`Backup file not found: ${filePath}`));
        process.exit(1);
      }
      console.log(chalk.bold(`hasna backup restore\n`));
      console.log(chalk.dim(`  Source: ${filePath}`));
      console.log(chalk.dim(`  Target: ${HASNA_HOME}\n`));
      if (opts.dryRun) {
        const listing = execSafe(`tar -tzf "${filePath}" 2>&1 | head -30`);
        console.log(chalk.dim("  Files (first 30):"));
        if (listing) {
          for (const line of listing.split("\n")) {
            console.log(chalk.dim(`    ${line}`));
          }
        }
        console.log(chalk.yellow(`\n  Dry run — no changes made.`));
        return;
      }
      if (!dirExists(HASNA_HOME)) {
        mkdirSync(HASNA_HOME, { recursive: true });
      }
      const result = execSafe(`tar -xzf "${filePath}" -C "${HASNA_HOME}" 2>&1`, 120000);
      if (result !== null) {
        console.log(chalk.green("  Restore complete."));
      } else {
        console.error(chalk.red("  Restore failed."));
        process.exit(1);
      }
    });

  backupCmd.command("list").description("List available backups in ~/.hasna/backups").action(() => {
    ensureBackupDir();
    console.log(chalk.bold(`hasna backup list\n`));
    let files: string[];
    try {
      files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".tar.gz")).sort().reverse();
    } catch {
      files = [];
    }
    if (files.length === 0) {
      console.log(chalk.dim("  No backups found."));
      console.log(chalk.dim(`  Run 'hasna backup create' to create one.`));
      return;
    }
    for (const file of files) {
      const full = join(BACKUP_DIR, file);
      const size = statSync(full).size;
      const mtime = statSync(full).mtime.toISOString().slice(0, 19).replace("T", " ");
      console.log(`  ${chalk.cyan(file)}  ${formatBytes(size)}  ${chalk.dim(mtime)}`);
    }
    console.log(chalk.dim(`\n  ${files.length} backup(s) in ${BACKUP_DIR}`));
  });
}
