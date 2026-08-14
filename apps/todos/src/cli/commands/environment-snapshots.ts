import type { Command } from "commander";
import chalk from "chalk";
import {
  compareEnvironmentSnapshotFiles,
  recordEnvironmentSnapshot,
} from "../../lib/environment-snapshots.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function registerEnvironmentSnapshotCommands(program: Command): void {
  const envCmd = program
    .command("env-snapshot")
    .alias("environment-snapshot")
    .description("Capture and compare local reproducible environment snapshots");

  envCmd
    .command("capture")
    .description("Capture runtime, package-manager, git, config hash, and redacted environment metadata")
    .option("--root <path>", "Project root to inspect")
    .option("--task <id>", "Attach snapshot evidence to a task")
    .option("--run <id>", "Attach snapshot artifact to a task run")
    .option("--agent <name>", "Agent name for attached evidence")
    .option("--command <command>", "Command or verification step this snapshot explains")
    .option("--output <path>", "Write snapshot JSON to a specific path")
    .option("--include-env-values", "Include nonsecret environment values; secret-like keys are still redacted")
    .action((opts) => {
      const globalOpts = program.opts();
      try {
        const result = recordEnvironmentSnapshot({
          root: opts.root,
          task_id: opts.task,
          run_id: opts.run,
          agent_id: opts.agent || globalOpts.agent,
          command: opts.command,
          output_path: opts.output,
          include_env_values: Boolean(opts.includeEnvValues),
        });

        if (globalOpts.json) {
          printJson(result);
          return;
        }

        console.log(chalk.green("Captured") + ` ${result.snapshot.id}`);
        console.log(`path: ${result.output_path}`);
        console.log(`root: ${result.snapshot.root}`);
        console.log(`git: ${result.snapshot.git.commit || "none"}${result.snapshot.git.is_dirty ? " dirty" : ""}`);
        console.log(`runtime: bun ${result.snapshot.runtime.bun || "unknown"} / node ${result.snapshot.runtime.node}`);
        if (result.run_artifact_id) console.log(`run artifact: ${result.run_artifact_id}`);
        if (result.task_verification_id) console.log(`task verification: ${result.task_verification_id}`);
        for (const warning of result.snapshot.warnings) console.log(chalk.yellow(`warning: ${warning}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (globalOpts.json) printJson({ error: message });
        else console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });

  envCmd
    .command("compare")
    .description("Compare two environment snapshot JSON files")
    .argument("<left>", "Left snapshot JSON path")
    .argument("<right>", "Right snapshot JSON path")
    .action((left: string, right: string) => {
      const globalOpts = program.opts();
      try {
        const comparison = compareEnvironmentSnapshotFiles(left, right);
        if (globalOpts.json) {
          printJson(comparison);
          return;
        }
        console.log(`left: ${comparison.left_id}`);
        console.log(`right: ${comparison.right_id}`);
        console.log(`same root: ${comparison.same_root}`);
        console.log(`same machine: ${comparison.same_machine}`);
        console.log(`same runtime: ${comparison.same_runtime}`);
        console.log(`same git commit: ${comparison.same_git_commit}`);
        console.log(`dirty state changed: ${comparison.dirty_state_changed}`);
        const changed = comparison.changed_config_hashes.length + comparison.changed_lockfiles.length + comparison.changed_manifests.length;
        console.log(`changed files: ${changed}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (globalOpts.json) printJson({ error: message });
        else console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    });
}
