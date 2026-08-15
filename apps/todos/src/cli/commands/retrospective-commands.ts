import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../../db/database.js";
import {
  createRetrospective,
  createRetrospectiveExport,
  getRetrospective,
  listRetrospectives,
  renderRetrospectiveMarkdown,
} from "../../db/retrospectives.js";
import { handleError, output } from "../helpers.js";

function commonFilters(opts: Record<string, any>) {
  return {
    project_id: opts.project,
    plan_id: opts.plan,
    agent_id: opts.agent,
    limit: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
  };
}

function printRetrospective(record: ReturnType<typeof createRetrospective>): void {
  const report = record.report;
  console.log(`${chalk.cyan(record.id.slice(0, 8))} ${chalk.bold(record.title)} ${chalk.dim(`${record.scope}:${report.scope_id.slice(0, 8)}`)}`);
  console.log(chalk.dim(`  tasks: ${report.summary.completed_tasks}/${report.summary.total_tasks} completed · missed: ${report.summary.missed_estimates} · blockers: ${report.summary.recurring_blockers} · failed checks: ${report.summary.failed_verifications}`));
  for (const lesson of report.lessons.slice(0, 3)) console.log(`  - ${lesson}`);
}

export function registerRetrospectiveCommands(program: Command) {
  const retrospectives = program
    .command("retrospectives")
    .alias("retro")
    .description("Generate and store local retrospectives and lessons learned from project or plan evidence");

  retrospectives
    .command("create")
    .description("Create a local retrospective report")
    .option("--title <title>", "Report title")
    .option("--project <id>", "Project to summarize")
    .option("--plan <id>", "Plan to summarize")
    .option("--agent <id>", "Agent creating the retrospective")
    .option("--create-followups", "Create suggested local follow-up tasks")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const globalOpts = program.opts();
        const record = createRetrospective({
          title: opts.title,
          project_id: opts.project,
          plan_id: opts.plan,
          agent_id: opts.agent || globalOpts.agent,
          create_followups: Boolean(opts.createFollowups),
        }, getDatabase());
        if (opts.json || globalOpts.json) output(record, true);
        else printRetrospective(record);
      } catch (error) { handleError(error); }
    });

  retrospectives
    .command("list")
    .description("List stored local retrospectives")
    .option("--project <id>", "Filter by project")
    .option("--plan <id>", "Filter by plan")
    .option("--agent <id>", "Filter by creating agent")
    .option("--limit <n>", "Maximum records", "50")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const globalOpts = program.opts();
        const records = listRetrospectives(commonFilters(opts), getDatabase());
        if (opts.json || globalOpts.json) output(records, true);
        else records.forEach(printRetrospective);
      } catch (error) { handleError(error); }
    });

  retrospectives
    .command("show <id>")
    .description("Show one stored local retrospective")
    .option("--format <format>", "json or markdown", "json")
    .option("-j, --json", "Output as JSON")
    .action((id: string, opts) => {
      try {
        const record = getRetrospective(id, getDatabase());
        if (!record) throw new Error(`Retrospective not found: ${id}`);
        if (opts.format === "markdown") {
          console.log(renderRetrospectiveMarkdown(record));
          return;
        }
        if (opts.format !== "json") throw new Error("--format must be json or markdown");
        output(record, true);
      } catch (error) { handleError(error); }
    });

  retrospectives
    .command("export")
    .description("Export stored local retrospectives as deterministic JSON or Markdown")
    .option("--project <id>", "Filter by project")
    .option("--plan <id>", "Filter by plan")
    .option("--agent <id>", "Filter by creating agent")
    .option("--limit <n>", "Maximum records", "100")
    .option("--format <format>", "json or markdown", "json")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const report = createRetrospectiveExport(commonFilters(opts), getDatabase());
        if (opts.format === "markdown") {
          console.log(renderRetrospectiveMarkdown(report));
          return;
        }
        if (opts.format !== "json") throw new Error("--format must be json or markdown");
        output(report, true);
      } catch (error) { handleError(error); }
    });
}
