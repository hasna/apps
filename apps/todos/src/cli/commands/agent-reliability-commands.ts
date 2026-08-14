import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../../db/database.js";
import {
  createAgentReliabilityExport,
  getAgentReliabilityScorecard,
  renderAgentReliabilityMarkdown,
  type AgentReliabilityScorecard,
} from "../../db/agent-metrics.js";
import { handleError, output } from "../helpers.js";

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function commonOptions(opts: Record<string, any>) {
  return {
    project_id: opts.project,
    since: opts.since,
    stale_after_hours: parseNumber(opts.staleAfterHours, 24),
  };
}

function printScorecard(scorecard: AgentReliabilityScorecard): void {
  const color = scorecard.grade === "at_risk"
    ? chalk.red
    : scorecard.grade === "watch"
      ? chalk.yellow
      : scorecard.grade === "excellent"
        ? chalk.green
        : chalk.white;
  console.log(`${chalk.cyan(scorecard.agent_id.slice(0, 8))} ${color(`${scorecard.score}/100`)} ${chalk.bold(scorecard.agent_name)} ${chalk.dim(scorecard.grade)}`);
  console.log(chalk.dim(`  completed: ${scorecard.signals.tasks_completed} · failed: ${scorecard.signals.tasks_failed} · failed checks: ${scorecard.signals.failed_verifications} · failed runs: ${scorecard.signals.runs_failed} · stale locks: ${scorecard.signals.stale_task_locks + scorecard.signals.stale_resource_locks}`));
  for (const recommendation of scorecard.recommendations.slice(0, 3)) console.log(`  - ${recommendation}`);
}

export function registerAgentReliabilityCommands(program: Command) {
  const reliability = program
    .command("reliability")
    .alias("scorecards")
    .description("Generate local-only agent reliability scorecards from tasks, runs, verification evidence, locks, retries, and handoffs");

  reliability
    .command("show <agent>")
    .description("Show one local agent reliability scorecard")
    .option("--project <id>", "Filter by project")
    .option("--since <iso>", "Only include task and evidence created at or after this timestamp")
    .option("--stale-after-hours <hours>", "Task locks older than this are considered stale", "24")
    .option("--format <format>", "json or markdown", "json")
    .option("-j, --json", "Output as JSON")
    .action((agent: string, opts) => {
      try {
        const scorecard = getAgentReliabilityScorecard(agent, commonOptions(opts), getDatabase());
        if (!scorecard) throw new Error(`Agent not found: ${agent}`);
        if (opts.format === "markdown") {
          console.log(renderAgentReliabilityMarkdown(scorecard));
          return;
        }
        if (opts.format !== "json") throw new Error("--format must be json or markdown");
        const globalOpts = program.opts();
        if (opts.json || globalOpts.json) output(scorecard, true);
        else printScorecard(scorecard);
      } catch (error) { handleError(error); }
    });

  reliability
    .command("list")
    .description("List local agent reliability scorecards")
    .option("--agent <id>", "Filter by agent id or name")
    .option("--project <id>", "Filter by project")
    .option("--since <iso>", "Only include task and evidence created at or after this timestamp")
    .option("--stale-after-hours <hours>", "Task locks older than this are considered stale", "24")
    .option("--limit <n>", "Maximum scorecards", "50")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const report = createAgentReliabilityExport({
          ...commonOptions(opts),
          agent_id: opts.agent,
          limit: parseNumber(opts.limit, 50),
        }, getDatabase());
        const globalOpts = program.opts();
        if (opts.json || globalOpts.json) output(report.scorecards, true);
        else report.scorecards.forEach(printScorecard);
      } catch (error) { handleError(error); }
    });

  reliability
    .command("export")
    .description("Export local agent reliability scorecards as deterministic JSON or Markdown")
    .option("--agent <id>", "Filter by agent id or name")
    .option("--project <id>", "Filter by project")
    .option("--since <iso>", "Only include task and evidence created at or after this timestamp")
    .option("--stale-after-hours <hours>", "Task locks older than this are considered stale", "24")
    .option("--limit <n>", "Maximum scorecards", "100")
    .option("--format <format>", "json or markdown", "json")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const report = createAgentReliabilityExport({
          ...commonOptions(opts),
          agent_id: opts.agent,
          limit: parseNumber(opts.limit, 100),
        }, getDatabase());
        if (opts.format === "markdown") {
          console.log(renderAgentReliabilityMarkdown(report));
          return;
        }
        if (opts.format !== "json") throw new Error("--format must be json or markdown");
        output(report, true);
      } catch (error) { handleError(error); }
    });
}
