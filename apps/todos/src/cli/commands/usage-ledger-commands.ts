import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import { autoProject, handleError, output, parseOptionalPositiveSafeInteger } from "../helpers.js";

function globalOptions(program: Command): Record<string, any> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, any> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function parsePositiveDecimal(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || value.trim() !== value) {
    console.error(chalk.red("cost quota must be a positive number"));
    process.exit(1);
  }
  return parsed;
}

function resolveProjectInput(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const resolved = autoProject({ project: value }) || resolvePartialId(getDatabase(), "projects", value);
  if (!resolved) {
    console.error(chalk.red(`Could not resolve project ID: ${value}`));
    process.exit(1);
  }
  return resolved;
}

export function registerUsageLedgerCommands(program: Command) {
  const usage = program
    .command("usage")
    .description("Report local task, run, command, cost, duration, storage, and quota usage");

  usage
    .command("report")
    .description("Build an aggregate local usage ledger")
    .option("--project <id>", "Filter by project")
    .option("--agent <name>", "Filter by agent")
    .option("--since <iso>", "Only include records created or started at or after this timestamp")
    .option("--until <iso>", "Only include records created or started at or before this timestamp")
    .option("--max-tasks <n>", "Simulate a task quota")
    .option("--max-projects <n>", "Simulate a project quota")
    .option("--max-runs <n>", "Simulate a run quota")
    .option("--max-commands <n>", "Simulate a command quota")
    .option("--max-tokens <n>", "Simulate a token quota")
    .option("--max-cost-usd <n>", "Simulate a USD cost quota")
    .option("--max-storage-bytes <n>", "Simulate an evidence storage quota")
    .option("--format <format>", "json or markdown", "json")
    .option("-j, --json", "Output as JSON")
    .action(async (opts: {
      project?: string;
      agent?: string;
      since?: string;
      until?: string;
      maxTasks?: string;
      maxProjects?: string;
      maxRuns?: string;
      maxCommands?: string;
      maxTokens?: string;
      maxCostUsd?: string;
      maxStorageBytes?: string;
      format?: string;
      json?: boolean;
    }) => {
      try {
        const globalOpts = globalOptions(program);
        const { createLocalUsageLedger, renderLocalUsageLedgerMarkdown } = await import("../../lib/usage-ledger.js");
        const report = createLocalUsageLedger({
          project_id: resolveProjectInput(opts.project || globalOpts.project),
          agent_id: opts.agent || globalOpts.agent,
          since: opts.since,
          until: opts.until,
          quotas: {
            max_tasks: parseOptionalPositiveSafeInteger(opts.maxTasks, "--max-tasks"),
            max_projects: parseOptionalPositiveSafeInteger(opts.maxProjects, "--max-projects"),
            max_runs: parseOptionalPositiveSafeInteger(opts.maxRuns, "--max-runs"),
            max_commands: parseOptionalPositiveSafeInteger(opts.maxCommands, "--max-commands"),
            max_tokens: parseOptionalPositiveSafeInteger(opts.maxTokens, "--max-tokens"),
            max_cost_usd: parsePositiveDecimal(opts.maxCostUsd),
            max_storage_bytes: parseOptionalPositiveSafeInteger(opts.maxStorageBytes, "--max-storage-bytes"),
          },
        });
        const format = (opts.json || globalOpts.json) ? "json" : opts.format || "json";
        if (format === "markdown") {
          console.log(renderLocalUsageLedgerMarkdown(report));
          return;
        }
        if (format !== "json") throw new Error("--format must be json or markdown");
        output(report, true);
      } catch (error) {
        handleError(error);
      }
    });
}
