import type { Command } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { HASNA_HOME, copyStagedWithRollback, dirExists, execSafe, formatBytes, listTarball, spawnSafe } from "../utils.js";

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
      // argv-based: outputPath is operator-supplied and must never travel
      // through a shell (release-review P1: shell injection via user paths).
      const result = spawnSafe("tar", ["-czf", outputPath, "-C", HASNA_HOME, "--exclude=backups", "."], 120000);
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
      // Validate the archive BEFORE anything else: a truncated/corrupt tarball
      // must fail here, never after live data has been touched. The old
      // `tar -tzf ... | head -30` pipeline masked validation failures.
      const listing = listTarball(filePath, 30);
      if (listing === null) {
        console.error(chalk.red(`  Invalid or unreadable backup archive: ${filePath}`));
        console.error(chalk.red("  Refusing to restore from an unverified archive."));
        process.exit(1);
      }
      if (opts.dryRun) {
        console.log(chalk.dim("  Files (first 30):"));
        for (const line of listing.split("\n").filter(Boolean)) {
          console.log(chalk.dim(`    ${line}`));
        }
        console.log(chalk.yellow(`\n  Dry run — no changes made.`));
        return;
      }
      // Staged restore: extract into a verified staging directory first, then
      // copy over ~/.hasna with a pre-copy snapshot and rollback. A failed
      // extraction leaves live data untouched; a failed copy is rolled back to
      // the pre-copy state (and only if the rollback itself fails is the
      // snapshot preserved at a reported path for manual recovery).
      const staging = execSafe(`mktemp -d /tmp/hasna-restore.XXXXXX`, 5000);
      if (staging === null) {
        console.error(chalk.red("  Restore failed: could not create staging directory."));
        process.exit(1);
      }
      try {
        const extractResult = spawnSafe("tar", ["-xzf", filePath, "-C", staging], 120000);
        if (extractResult === null) {
          console.error(chalk.red("  Restore failed: archive extraction into staging failed."));
          console.error(chalk.red(`  Live data untouched. Staging: ${staging}`));
          process.exit(1);
        }
        // NO pre-creation of HASNA_HOME here: interrupted-swap recovery must
        // run BEFORE the target exists, or an empty recreated target would be
        // mistaken for a completed swap and the live preimage deleted
        // (release-review P1: recover before creating the target).
        const outcome = copyStagedWithRollback(staging, HASNA_HOME);
        if (outcome.warning) {
          console.error(chalk.yellow(`  ${outcome.warning}`));
        }
        if (outcome.ok) {
          console.log(chalk.green("  Restore complete."));
        } else if (outcome.copyApplied) {
          // The staged content is live, but the sensitive pre-copy snapshot
          // could not be removed — a HARD failure that MUST disclose the
          // retained snapshot (release-review P1: retained full-preimage
          // snapshots are reported with their path, never silently dropped).
          console.error(chalk.red("  Restore applied, but the pre-copy snapshot could not be removed."));
          console.error(chalk.red(`  Sensitive pre-copy snapshot retained at: ${outcome.snapshot}`));
          console.error(chalk.red("  Remove it manually once the restored data is verified."));
          process.exit(1);
        } else if (outcome.rolledBack) {
          console.error(chalk.red("  Restore failed: copying staged content into ~/.hasna failed."));
          console.error(chalk.red("  Live data was rolled back to the pre-copy state."));
          if (outcome.snapshot) {
            console.error(chalk.red(`  Pre-copy snapshot retained at: ${outcome.snapshot}`));
          }
          if (outcome.retainedSwap) {
            console.error(chalk.red(`  Displaced live tree retained at: ${outcome.retainedSwap}`));
          }
          process.exit(1);
        } else {
          console.error(chalk.red("  Restore failed: copying staged content into ~/.hasna failed."));
          if (outcome.snapshot) {
            console.error(chalk.red(`  Rollback could not complete. Pre-copy snapshot preserved at: ${outcome.snapshot}`));
          } else {
            console.error(chalk.red("  No pre-copy snapshot could be taken; live data may be partially restored."));
          }
          if (outcome.retainedSwap) {
            console.error(chalk.red(`  Displaced live tree retained at: ${outcome.retainedSwap}`));
          }
          console.error(chalk.red(`  Staged copy preserved at: ${staging}`));
          process.exit(1);
        }
      } finally {
        const cleanup = execSafe(`rm -rf "${staging}" 2>&1`, 5000);
        if (cleanup === null) {
          console.error(chalk.yellow(`  Warning: could not remove staging dir: ${staging}`));
        }
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
