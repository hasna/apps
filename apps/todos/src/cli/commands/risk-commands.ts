import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../../db/database.js";
import {
  closeRisk,
  createRisk,
  createRiskRegisterExport,
  getRisk,
  listRisks,
  renderRiskRegisterMarkdown,
  scorePlanHealth,
  scoreProjectHealth,
  updateRisk,
  type ProjectRiskProbability,
  type ProjectRiskSeverity,
  type ProjectRiskStatus,
} from "../../db/project-risks.js";
import { handleError, output, parseOptionalPositiveSafeInteger } from "../helpers.js";

const STATUSES = ["open", "mitigating", "resolved", "accepted"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const PROBABILITIES = ["low", "medium", "high"] as const;

function parseChoice<T extends string>(value: string, choices: readonly T[], label: string): T {
  if ((choices as readonly string[]).includes(value)) return value as T;
  console.error(chalk.red(`${label} must be one of: ${choices.join(", ")}`));
  process.exit(1);
}

function parseJsonObject(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return parsed as Record<string, unknown>;
  } catch {
    console.error(chalk.red(`${label} must be a valid JSON object`));
    process.exit(1);
  }
}

function tagsFromOption(value: string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const tags = value.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function commonFilters(opts: Record<string, any>) {
  return {
    status: opts.status ? parseChoice(opts.status, STATUSES, "--status") : undefined,
    severity: opts.severity ? parseChoice(opts.severity, SEVERITIES, "--severity") : undefined,
    probability: opts.probability ? parseChoice(opts.probability, PROBABILITIES, "--probability") : undefined,
    owner: opts.owner,
    project_id: opts.project,
    plan_id: opts.plan,
    task_id: opts.task,
    tag: opts.tag,
    include_closed: Boolean(opts.includeClosed),
    limit: parseOptionalPositiveSafeInteger(opts.limit, "--limit"),
  };
}

function printRisk(risk: ReturnType<typeof createRisk>): void {
  const color = risk.severity === "critical" ? chalk.red : risk.severity === "high" ? chalk.yellow : chalk.white;
  console.log(`${chalk.cyan(risk.id.slice(0, 8))} ${color(risk.severity)} ${chalk.bold(risk.status)} ${risk.title}`);
  if (risk.owner) console.log(chalk.dim(`  owner: ${risk.owner}`));
  if (risk.due_at) console.log(chalk.dim(`  due: ${risk.due_at}`));
  if (risk.plan_id) console.log(chalk.dim(`  plan: ${risk.plan_id}`));
  if (risk.project_id) console.log(chalk.dim(`  project: ${risk.project_id}`));
  if (risk.mitigation) console.log(`  mitigation: ${risk.mitigation}`);
}

export function registerRiskCommands(program: Command) {
  const risks = program
    .command("risks")
    .description("Manage local project and plan risks, and score local plan/project health");

  risks
    .command("add <title>")
    .description("Add a local risk register entry")
    .option("--description <text>", "Risk description")
    .option("--status <status>", "Risk status: open, mitigating, resolved, accepted", "open")
    .option("--severity <severity>", "Risk severity: low, medium, high, critical", "medium")
    .option("--probability <probability>", "Risk probability: low, medium, high", "medium")
    .option("--owner <owner>", "Risk owner")
    .option("--mitigation <text>", "Mitigation plan")
    .option("--due <iso>", "Risk mitigation due date")
    .option("--project <id>", "Link to a project")
    .option("--plan <id>", "Link to a plan")
    .option("--task <id>", "Link to a task")
    .option("--tag <tag>", "Tag; repeatable or comma-separated", (value, previous: string[]) => [...previous, value], [])
    .option("--metadata-json <json>", "JSON object metadata")
    .option("-j, --json", "Output as JSON")
    .action((title: string, opts) => {
      try {
        const globalOpts = program.opts();
        const risk = createRisk({
          title,
          description: opts.description,
          status: parseChoice(opts.status, STATUSES, "--status") as ProjectRiskStatus,
          severity: parseChoice(opts.severity, SEVERITIES, "--severity") as ProjectRiskSeverity,
          probability: parseChoice(opts.probability, PROBABILITIES, "--probability") as ProjectRiskProbability,
          owner: opts.owner,
          mitigation: opts.mitigation,
          due_at: opts.due,
          project_id: opts.project,
          plan_id: opts.plan,
          task_id: opts.task,
          tags: tagsFromOption(opts.tag),
          metadata: parseJsonObject(opts.metadataJson, "--metadata-json"),
        }, getDatabase());
        if (opts.json || globalOpts.json) output(risk, true);
        else printRisk(risk);
      } catch (error) { handleError(error); }
    });

  risks
    .command("list")
    .description("List local risk register entries")
    .option("--status <status>", "Filter by status")
    .option("--severity <severity>", "Filter by severity")
    .option("--probability <probability>", "Filter by probability")
    .option("--owner <owner>", "Filter by owner")
    .option("--project <id>", "Filter by project")
    .option("--plan <id>", "Filter by plan")
    .option("--task <id>", "Filter by task")
    .option("--tag <tag>", "Filter by tag")
    .option("--include-closed", "Include resolved and accepted risks")
    .option("--limit <n>", "Maximum records", "50")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const globalOpts = program.opts();
        const records = listRisks(commonFilters(opts), getDatabase());
        if (opts.json || globalOpts.json) output(records, true);
        else records.forEach(printRisk);
      } catch (error) { handleError(error); }
    });

  risks
    .command("show <id>")
    .description("Show one local risk")
    .option("-j, --json", "Output as JSON")
    .action((id: string, opts) => {
      try {
        const globalOpts = program.opts();
        const risk = getRisk(id, getDatabase());
        if (!risk) throw new Error(`Risk not found: ${id}`);
        if (opts.json || globalOpts.json) output(risk, true);
        else printRisk(risk);
      } catch (error) { handleError(error); }
    });

  risks
    .command("update <id>")
    .description("Update a local risk")
    .option("--title <title>", "New title")
    .option("--description <text>", "Risk description")
    .option("--status <status>", "Risk status")
    .option("--severity <severity>", "Risk severity")
    .option("--probability <probability>", "Risk probability")
    .option("--owner <owner>", "Risk owner")
    .option("--mitigation <text>", "Mitigation plan")
    .option("--due <iso>", "Risk mitigation due date")
    .option("--project <id>", "Link to a project")
    .option("--plan <id>", "Link to a plan")
    .option("--task <id>", "Link to a task")
    .option("--tag <tag>", "Replace tags; repeatable or comma-separated", (value, previous: string[]) => [...previous, value], [])
    .option("--metadata-json <json>", "Replace JSON object metadata")
    .option("-j, --json", "Output as JSON")
    .action((id: string, opts) => {
      try {
        const globalOpts = program.opts();
        const risk = updateRisk(id, {
          title: opts.title,
          description: opts.description,
          status: opts.status ? parseChoice(opts.status, STATUSES, "--status") : undefined,
          severity: opts.severity ? parseChoice(opts.severity, SEVERITIES, "--severity") : undefined,
          probability: opts.probability ? parseChoice(opts.probability, PROBABILITIES, "--probability") : undefined,
          owner: opts.owner,
          mitigation: opts.mitigation,
          due_at: opts.due,
          project_id: opts.project,
          plan_id: opts.plan,
          task_id: opts.task,
          tags: opts.tag.length > 0 ? tagsFromOption(opts.tag) : undefined,
          metadata: parseJsonObject(opts.metadataJson, "--metadata-json"),
        }, getDatabase());
        if (opts.json || globalOpts.json) output(risk, true);
        else printRisk(risk);
      } catch (error) { handleError(error); }
    });

  risks
    .command("close <id>")
    .description("Close a risk as resolved or accepted")
    .option("--status <status>", "resolved or accepted", "resolved")
    .option("-j, --json", "Output as JSON")
    .action((id: string, opts) => {
      try {
        const status = parseChoice(opts.status, ["resolved", "accepted"] as const, "--status");
        const globalOpts = program.opts();
        const risk = closeRisk(id, status, getDatabase());
        if (opts.json || globalOpts.json) output(risk, true);
        else printRisk(risk);
      } catch (error) { handleError(error); }
    });

  risks
    .command("score")
    .description("Score local health for a plan or project")
    .option("--plan <id>", "Plan to score")
    .option("--project <id>", "Project to score")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        if (!opts.plan && !opts.project) throw new Error("Provide --plan or --project");
        if (opts.plan && opts.project) throw new Error("Use only one of --plan or --project");
        const report = opts.plan ? scorePlanHealth(opts.plan, getDatabase()) : scoreProjectHealth(opts.project, getDatabase());
        const globalOpts = program.opts();
        if (opts.json || globalOpts.json) output(report, true);
        else {
          console.log(`${chalk.bold("Health")} ${report.status} (${report.score}/100)`);
          console.log(chalk.dim(`${report.components.total_tasks} tasks · ${report.components.blocked_tasks} blocked · ${report.components.overdue_tasks} overdue · ${report.components.open_risks} open risks`));
          for (const recommendation of report.recommendations) console.log(`- ${recommendation}`);
        }
      } catch (error) { handleError(error); }
    });

  risks
    .command("export")
    .description("Export local risk register entries as deterministic JSON or Markdown")
    .option("--status <status>", "Filter by status")
    .option("--severity <severity>", "Filter by severity")
    .option("--probability <probability>", "Filter by probability")
    .option("--owner <owner>", "Filter by owner")
    .option("--project <id>", "Filter by project")
    .option("--plan <id>", "Filter by plan")
    .option("--task <id>", "Filter by task")
    .option("--tag <tag>", "Filter by tag")
    .option("--include-closed", "Include resolved and accepted risks")
    .option("--limit <n>", "Maximum records", "100")
    .option("--format <format>", "json or markdown", "json")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const report = createRiskRegisterExport(commonFilters(opts), getDatabase());
        if (opts.format === "markdown") {
          console.log(renderRiskRegisterMarkdown(report));
          return;
        }
        if (opts.format !== "json") throw new Error("--format must be json or markdown");
        output(report, true);
      } catch (error) { handleError(error); }
    });
}
