import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../../db/database.js";
import {
  createKnowledgeExportReport,
  createKnowledgeRecord,
  createKnowledgeSnapshot,
  getKnowledgeRecord,
  listKnowledgeRecords,
  renderKnowledgeExportMarkdown,
  searchKnowledgeRecords,
  type KnowledgeRecordType,
} from "../../db/project-knowledge.js";
import { handleError, output } from "../helpers.js";

const RECORD_TYPES = ["decision", "architecture_note", "tradeoff", "context_snapshot"] as const;

function parseRecordType(value: string): KnowledgeRecordType {
  if ((RECORD_TYPES as readonly string[]).includes(value)) return value as KnowledgeRecordType;
  console.error(chalk.red(`type must be one of: ${RECORD_TYPES.join(", ")}`));
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
    record_type: opts.type ? parseRecordType(opts.type) : undefined,
    task_id: opts.task,
    project_id: opts.project,
    plan_id: opts.plan,
    agent_id: opts.agent,
    tag: opts.tag,
    limit: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
  };
}

function printRecord(record: ReturnType<typeof createKnowledgeRecord>): void {
  console.log(`${chalk.cyan(record.id.slice(0, 8))} ${chalk.yellow(record.record_type)} ${record.title}`);
  if (record.task_id) console.log(chalk.dim(`  task: ${record.task_id}`));
  if (record.project_id) console.log(chalk.dim(`  project: ${record.project_id}`));
  if (record.tags.length > 0) console.log(chalk.dim(`  tags: ${record.tags.join(", ")}`));
  if (record.decision) console.log(`  decision: ${record.decision}`);
  else if (record.content) console.log(`  ${record.content}`);
}

export function registerKnowledgeCommands(program: Command) {
  const knowledge = program
    .command("knowledge")
    .description("Manage local project knowledge records, decisions, tradeoffs, and context snapshots");

  knowledge
    .command("add <type> <title>")
    .description("Add a local knowledge record")
    .option("--content <text>", "Record body or note")
    .option("--decision <text>", "Decision outcome")
    .option("--rationale <text>", "Decision rationale")
    .option("--alternative <text>", "Alternative considered; repeatable", (value, previous: string[]) => [...previous, value], [])
    .option("--task <id>", "Link to a task")
    .option("--project <id>", "Link to a project")
    .option("--plan <id>", "Link to a plan")
    .option("--agent <id>", "Agent that authored or owns the record")
    .option("--tag <tag>", "Tag; repeatable or comma-separated", (value, previous: string[]) => [...previous, value], [])
    .option("--metadata-json <json>", "JSON object metadata")
    .option("-j, --json", "Output as JSON")
    .action((type: string, title: string, opts) => {
      try {
        const globalOpts = program.opts();
        const record = createKnowledgeRecord({
          record_type: parseRecordType(type),
          title,
          content: opts.content,
          decision: opts.decision,
          rationale: opts.rationale,
          alternatives: opts.alternative,
          task_id: opts.task,
          project_id: opts.project,
          plan_id: opts.plan,
          agent_id: opts.agent || globalOpts.agent,
          tags: tagsFromOption(opts.tag),
          metadata: parseJsonObject(opts.metadataJson, "--metadata-json"),
        }, getDatabase());
        if (opts.json || globalOpts.json) output(record, true);
        else printRecord(record);
      } catch (error) { handleError(error); }
    });

  knowledge
    .command("snapshot")
    .description("Save a local context snapshot and attach it as a knowledge record")
    .requiredOption("--summary <text>", "Snapshot summary")
    .option("--title <text>", "Knowledge record title")
    .option("--snapshot-type <type>", "Snapshot type: interrupt, complete, handoff, checkpoint", "checkpoint")
    .option("--task <id>", "Link to a task")
    .option("--project <id>", "Link to a project")
    .option("--agent <id>", "Agent that produced the snapshot")
    .option("--file <path>", "Open or relevant file; repeatable", (value, previous: string[]) => [...previous, value], [])
    .option("--attempt <text>", "Attempt summary; repeatable", (value, previous: string[]) => [...previous, value], [])
    .option("--blocker <text>", "Blocker summary; repeatable", (value, previous: string[]) => [...previous, value], [])
    .option("--next <text>", "Next steps")
    .option("--tag <tag>", "Tag; repeatable or comma-separated", (value, previous: string[]) => [...previous, value], [])
    .option("--metadata-json <json>", "JSON object metadata")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const globalOpts = program.opts();
        const result = createKnowledgeSnapshot({
          title: opts.title,
          summary: opts.summary,
          snapshot_type: opts.snapshotType,
          task_id: opts.task,
          project_id: opts.project,
          agent_id: opts.agent || globalOpts.agent,
          files_open: opts.file,
          attempts: opts.attempt,
          blockers: opts.blocker,
          next_steps: opts.next,
          tags: tagsFromOption(opts.tag),
          metadata: parseJsonObject(opts.metadataJson, "--metadata-json"),
        }, getDatabase());
        if (opts.json || globalOpts.json) output(result, true);
        else {
          console.log(chalk.green(`Snapshot ${result.snapshot_id.slice(0, 8)} saved.`));
          printRecord(result.record);
        }
      } catch (error) { handleError(error); }
    });

  knowledge
    .command("list")
    .description("List local knowledge records")
    .option("--type <type>", "Filter by record type")
    .option("--task <id>", "Filter by task")
    .option("--project <id>", "Filter by project")
    .option("--plan <id>", "Filter by plan")
    .option("--agent <id>", "Filter by agent")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Maximum records", "50")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const globalOpts = program.opts();
        const records = listKnowledgeRecords(commonFilters(opts), getDatabase());
        if (opts.json || globalOpts.json) output(records, true);
        else records.forEach(printRecord);
      } catch (error) { handleError(error); }
    });

  knowledge
    .command("search <query>")
    .description("Search local knowledge records")
    .option("--type <type>", "Filter by record type")
    .option("--task <id>", "Filter by task")
    .option("--project <id>", "Filter by project")
    .option("--plan <id>", "Filter by plan")
    .option("--agent <id>", "Filter by agent")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Maximum records", "50")
    .option("-j, --json", "Output as JSON")
    .action((query: string, opts) => {
      try {
        const globalOpts = program.opts();
        const records = searchKnowledgeRecords({ ...commonFilters(opts), query }, getDatabase());
        if (opts.json || globalOpts.json) output(records, true);
        else records.forEach(printRecord);
      } catch (error) { handleError(error); }
    });

  knowledge
    .command("show <id>")
    .description("Show one local knowledge record")
    .option("-j, --json", "Output as JSON")
    .action((id: string, opts) => {
      try {
        const globalOpts = program.opts();
        const record = getKnowledgeRecord(id, getDatabase());
        if (!record) throw new Error(`Knowledge record not found: ${id}`);
        if (opts.json || globalOpts.json) output(record, true);
        else printRecord(record);
      } catch (error) { handleError(error); }
    });

  knowledge
    .command("export")
    .description("Export local knowledge records as deterministic JSON or Markdown")
    .option("--query <text>", "Search query before exporting")
    .option("--type <type>", "Filter by record type")
    .option("--task <id>", "Filter by task")
    .option("--project <id>", "Filter by project")
    .option("--plan <id>", "Filter by plan")
    .option("--agent <id>", "Filter by agent")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Maximum records", "100")
    .option("--format <format>", "json or markdown", "json")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      try {
        const globalOpts = program.opts();
        const report = createKnowledgeExportReport({ ...commonFilters(opts), query: opts.query }, getDatabase());
        if (opts.format === "markdown") {
          console.log(renderKnowledgeExportMarkdown(report));
          return;
        }
        if (opts.format !== "json") throw new Error("--format must be json or markdown");
        output(report, Boolean(opts.json || globalOpts.json || opts.format === "json"));
      } catch (error) { handleError(error); }
    });
}
