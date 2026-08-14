import type { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import { autoProject, handleError, output } from "../helpers.js";

function globalOptions(program: Command): Record<string, any> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, any> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function printCreateSummary(result: { output_path?: string | null; backup: { checksum: string; manifest: { bridge: { stats: Record<string, number>; artifact_contents: number } } } }) {
  console.log(chalk.bold("todos local backup"));
  if (result.output_path) console.log(`File: ${result.output_path}`);
  console.log(`Checksum: ${result.backup.checksum}`);
  console.log(`Tasks: ${result.backup.manifest.bridge.stats.tasks ?? 0}`);
  console.log(`Artifacts: ${result.backup.manifest.bridge.artifact_contents}`);
}

export function registerLocalBackupCommands(program: Command) {
  const backup = program
    .command("backup")
    .description("Create, verify, restore, and inspect local backup bundles");

  backup
    .command("create")
    .description("Create a local backup bundle with a manifest and checksums")
    .option("-o, --output <path>", "Write backup JSON to a file")
    .option("--project-id <id>", "Project id to scope the backup. Defaults to auto-detected project when available.")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { output?: string; projectId?: string; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { createLocalBackup } = await import("../../lib/local-backups.js");
        const projectId = opts.projectId ?? autoProject(globalOpts);
        const backupBundle = createLocalBackup({
          project_id: projectId,
          output_path: opts.output ? resolve(opts.output) : undefined,
        });
        const result = {
          output_path: opts.output ? resolve(opts.output) : null,
          backup: backupBundle,
        };
        if (opts.json || globalOpts.json) {
          output(result, true);
          return;
        }
        printCreateSummary(result);
      } catch (error) {
        handleError(error);
      }
    });

  backup
    .command("verify <file>")
    .description("Verify a local backup bundle checksum, manifest, bridge schema, and current SQLite integrity")
    .option("-j, --json", "Output as JSON")
    .action(async (file: string, opts: { json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { readLocalBackupFile, verifyLocalBackup } = await import("../../lib/local-backups.js");
        const verification = verifyLocalBackup(readLocalBackupFile(file));
        if (opts.json || globalOpts.json) {
          output(verification, true);
          return;
        }
        console.log(chalk.bold(`Backup ${verification.ok ? "verified" : "has issues"}`));
        console.log(`Checksum: ${verification.checksum.ok ? "ok" : "mismatch"}`);
        console.log(`Bridge: ${verification.bridge_checksum.ok ? "ok" : "mismatch"}`);
        for (const issue of verification.issues) console.error(chalk.red(`  ${issue}`));
        for (const warning of verification.warnings) console.error(chalk.yellow(`  ${warning}`));
      } catch (error) {
        handleError(error);
      }
    });

  backup
    .command("restore <file>")
    .description("Dry-run or apply a local backup restore. Dry-run is the default.")
    .option("--apply", "Apply the restore. Defaults to dry-run.")
    .option("--resolve-conflicts", "Safely merge existing local tasks while preserving divergent fields")
    .option("-j, --json", "Output as JSON")
    .action(async (file: string, opts: { apply?: boolean; resolveConflicts?: boolean; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { readLocalBackupFile, restoreLocalBackup } = await import("../../lib/local-backups.js");
        const result = restoreLocalBackup(readLocalBackupFile(file), {
          apply: Boolean(opts.apply),
          conflict_strategy: opts.resolveConflicts ? "safe_merge" : "skip",
        });
        if (opts.json || globalOpts.json) {
          output(result, true);
          return;
        }
        console.log(chalk.bold(`${result.dry_run ? "Restore dry-run" : "Restore"} ${result.ok ? "ready" : "has issues"}`));
        if (result.import_result) {
          for (const [key, count] of Object.entries(result.import_result.inserted)) {
            if (count > 0) console.log(`  ${key}: ${count}`);
          }
          if (result.import_result.conflicts.length > 0) {
            console.log(chalk.yellow(`  conflicts: ${result.import_result.conflicts.length}`));
          }
        }
        for (const issue of result.issues) console.error(chalk.red(`  ${issue}`));
      } catch (error) {
        handleError(error);
      }
    });

  backup
    .command("integrity")
    .description("Check local SQLite, bridge, count, and orphan-row integrity")
    .option("--project-id <id>", "Optional project id to scope bridge counts")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: { projectId?: string; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const { checkLocalIntegrity } = await import("../../lib/local-backups.js");
        const report = checkLocalIntegrity({
          project_id: opts.projectId ?? autoProject(globalOpts),
        });
        if (opts.json || globalOpts.json) {
          output(report, true);
          return;
        }
        console.log(chalk.bold(`Local integrity ${report.ok ? "ok" : "needs attention"}`));
        console.log(`Quick check: ${report.sqlite.quick_check}`);
        console.log(`Foreign key violations: ${report.sqlite.foreign_key_violations}`);
        console.log(`Tasks: ${report.counts.tasks}`);
        for (const issue of report.issues) console.error(chalk.red(`  ${issue}`));
        for (const warning of report.warnings) console.error(chalk.yellow(`  ${warning}`));
      } catch (error) {
        handleError(error);
      }
    });
}
