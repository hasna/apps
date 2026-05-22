import { readFileSync, writeFileSync } from "node:fs";
import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import { handleError, output, resolveTaskId } from "../helpers.js";
import type { LocalMilestoneStatus, LocalRoadmapStatus, RoadmapBundle } from "../../lib/roadmaps.js";

function splitList(value?: string): string[] | undefined {
  return value?.split(";").flatMap((part) => part.split(",")).map((item) => item.trim()).filter(Boolean);
}

function resolveOptional(table: string, value?: string): string | undefined {
  if (!value) return undefined;
  const resolved = resolvePartialId(getDatabase(), table, value);
  if (!resolved) throw new Error(`Could not resolve ${table} ID: ${value}`);
  return resolved;
}

function resolveMany(table: string, values?: string[]): string[] | undefined {
  if (values === undefined) return undefined;
  if (table === "tasks") return values.map(resolveTaskId);
  return values.map((value) => {
    const resolved = resolvePartialId(getDatabase(), table, value);
    if (!resolved) throw new Error(`Could not resolve ${table} ID: ${value}`);
    return resolved;
  });
}

function globalOptions(program: Command): Record<string, any> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, any> };
  return command.optsWithGlobals?.() ?? program.opts();
}

export function registerRoadmapCommands(program: Command) {
  const roadmaps = program
    .command("roadmaps")
    .alias("roadmap")
    .description("Manage local roadmaps, milestones, and release groupings");

  roadmaps
    .command("create <name>")
    .description("Create a local roadmap")
    .option("--description <text>", "Description")
    .option("--project <id>", "Project ID")
    .option("--status <status>", "planned, active, completed, archived")
    .option("--owner <name>", "Owner name")
    .option("--agent <name>", "Agent owner")
    .option("--release <name>", "Default release label")
    .action(async (name: string, opts: { description?: string; project?: string; status?: LocalRoadmapStatus; owner?: string; agent?: string; release?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { createRoadmap } = await import("../../lib/roadmaps.js");
        const roadmap = createRoadmap({
          name,
          description: opts.description,
          project_id: resolveOptional("projects", opts.project || globalOpts.project),
          status: opts.status,
          owner: opts.owner,
          agent_id: opts.agent || globalOpts.agent,
          release: opts.release,
        });
        if (globalOpts.json) { output(roadmap, true); return; }
        console.log(chalk.green(`Roadmap created: ${roadmap.id.slice(0, 8)} ${roadmap.name}`));
      } catch (e) {
        handleError(e);
      }
    });

  roadmaps
    .command("list")
    .description("List local roadmaps")
    .option("--project <id>", "Project ID")
    .option("--status <status>", "Filter by status")
    .action(async (opts: { project?: string; status?: LocalRoadmapStatus }) => {
      const globalOpts = globalOptions(program);
      try {
        const { listRoadmaps } = await import("../../lib/roadmaps.js");
        const items = listRoadmaps({ project_id: resolveOptional("projects", opts.project || globalOpts.project), status: opts.status });
        if (globalOpts.json) { output(items, true); return; }
        if (items.length === 0) {
          console.log(chalk.dim("No roadmaps configured."));
          return;
        }
        for (const item of items) console.log(`${chalk.dim(item.id.slice(0, 8))} ${item.status.padEnd(9)} ${item.name}`);
      } catch (e) {
        handleError(e);
      }
    });

  roadmaps
    .command("show <roadmap>")
    .description("Show a roadmap summary")
    .option("--format <format>", "json or markdown", "json")
    .action(async (roadmap: string, opts: { format?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { renderRoadmapMarkdown, summarizeRoadmap } = await import("../../lib/roadmaps.js");
        if (opts.format === "markdown") {
          console.log(renderRoadmapMarkdown(roadmap));
          return;
        }
        const summary = summarizeRoadmap(roadmap);
        if (globalOpts.json || opts.format === "json") { output(summary, true); return; }
        console.log(`${summary.name}: ${summary.progress.percent_complete}% (${summary.progress.readiness})`);
      } catch (e) {
        handleError(e);
      }
    });

  roadmaps
    .command("update <roadmap>")
    .description("Update a local roadmap")
    .option("--name <name>", "New name")
    .option("--description <text>", "Description")
    .option("--project <id>", "Project ID")
    .option("--status <status>", "planned, active, completed, archived")
    .option("--owner <name>", "Owner name")
    .option("--agent <name>", "Agent owner")
    .option("--release <name>", "Release label")
    .action(async (roadmap: string, opts: { name?: string; description?: string; project?: string; status?: LocalRoadmapStatus; owner?: string; agent?: string; release?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { updateRoadmap } = await import("../../lib/roadmaps.js");
        const updated = updateRoadmap(roadmap, {
          name: opts.name,
          description: opts.description,
          project_id: resolveOptional("projects", opts.project),
          status: opts.status,
          owner: opts.owner,
          agent_id: opts.agent,
          release: opts.release,
        });
        if (globalOpts.json) { output(updated, true); return; }
        console.log(chalk.green(`Roadmap updated: ${updated.id.slice(0, 8)} ${updated.name}`));
      } catch (e) {
        handleError(e);
      }
    });

  roadmaps
    .command("delete <roadmap>")
    .description("Delete a local roadmap and its local milestone/release config")
    .action(async (roadmap: string) => {
      const globalOpts = globalOptions(program);
      try {
        const { deleteRoadmap } = await import("../../lib/roadmaps.js");
        const deleted = deleteRoadmap(roadmap);
        if (globalOpts.json) { output({ deleted }, true); return; }
        console.log(deleted ? chalk.green("Roadmap deleted.") : chalk.dim("No roadmap matched."));
      } catch (e) {
        handleError(e);
      }
    });

  const milestones = roadmaps.command("milestones").description("Manage roadmap milestones");

  milestones
    .command("add <roadmap> <title>")
    .description("Add a milestone to a roadmap")
    .option("--description <text>", "Description")
    .option("--due <iso>", "Due date or timestamp")
    .option("--status <status>", "planned, active, completed, blocked, archived")
    .option("--owner <name>", "Owner name")
    .option("--agent <name>", "Agent owner")
    .option("--tasks <list>", "Comma-separated task IDs")
    .option("--plans <list>", "Comma-separated plan IDs")
    .option("--runs <list>", "Comma-separated run IDs")
    .option("--release <name>", "Release label")
    .option("--tags <list>", "Comma-separated tags")
    .action(async (roadmap: string, title: string, opts: { description?: string; due?: string; status?: LocalMilestoneStatus; owner?: string; agent?: string; tasks?: string; plans?: string; runs?: string; release?: string; tags?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { createMilestone } = await import("../../lib/roadmaps.js");
        const milestone = createMilestone({
          roadmap_id: roadmap,
          title,
          description: opts.description,
          due_at: opts.due,
          status: opts.status,
          owner: opts.owner,
          agent_id: opts.agent || globalOpts.agent,
          task_ids: resolveMany("tasks", splitList(opts.tasks)),
          plan_ids: resolveMany("plans", splitList(opts.plans)),
          run_ids: resolveMany("task_runs", splitList(opts.runs)),
          release: opts.release,
          tags: splitList(opts.tags),
        });
        if (globalOpts.json) { output(milestone, true); return; }
        console.log(chalk.green(`Milestone added: ${milestone.id.slice(0, 8)} ${milestone.title}`));
      } catch (e) {
        handleError(e);
      }
    });

  milestones
    .command("update <milestone>")
    .description("Update a roadmap milestone")
    .option("--title <title>", "Title")
    .option("--description <text>", "Description")
    .option("--due <iso>", "Due date or timestamp")
    .option("--status <status>", "planned, active, completed, blocked, archived")
    .option("--owner <name>", "Owner name")
    .option("--agent <name>", "Agent owner")
    .option("--tasks <list>", "Comma-separated task IDs")
    .option("--plans <list>", "Comma-separated plan IDs")
    .option("--runs <list>", "Comma-separated run IDs")
    .option("--release <name>", "Release label")
    .option("--tags <list>", "Comma-separated tags")
    .action(async (milestone: string, opts: { title?: string; description?: string; due?: string; status?: LocalMilestoneStatus; owner?: string; agent?: string; tasks?: string; plans?: string; runs?: string; release?: string; tags?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { updateMilestone } = await import("../../lib/roadmaps.js");
        const updated = updateMilestone(milestone, {
          title: opts.title,
          description: opts.description,
          due_at: opts.due,
          status: opts.status,
          owner: opts.owner,
          agent_id: opts.agent,
          task_ids: opts.tasks === undefined ? undefined : resolveMany("tasks", splitList(opts.tasks)),
          plan_ids: opts.plans === undefined ? undefined : resolveMany("plans", splitList(opts.plans)),
          run_ids: opts.runs === undefined ? undefined : resolveMany("task_runs", splitList(opts.runs)),
          release: opts.release,
          tags: opts.tags === undefined ? undefined : splitList(opts.tags),
        });
        if (globalOpts.json) { output(updated, true); return; }
        console.log(chalk.green(`Milestone updated: ${updated.id.slice(0, 8)} ${updated.title}`));
      } catch (e) {
        handleError(e);
      }
    });

  const releases = roadmaps.command("releases").description("Manage roadmap release groups");

  releases
    .command("set <roadmap> <name>")
    .description("Create or update a release grouping")
    .option("--release-version <version>", "Version label")
    .option("--status <status>", "planned, active, completed, blocked, archived")
    .option("--milestones <list>", "Comma-separated milestone IDs")
    .option("--tasks <list>", "Comma-separated task IDs")
    .option("--plans <list>", "Comma-separated plan IDs")
    .option("--runs <list>", "Comma-separated run IDs")
    .option("--notes <text>", "Release notes")
    .action(async (roadmap: string, name: string, opts: { releaseVersion?: string; status?: LocalMilestoneStatus; milestones?: string; tasks?: string; plans?: string; runs?: string; notes?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { upsertReleaseGroup } = await import("../../lib/roadmaps.js");
        const release = upsertReleaseGroup({
          roadmap_id: roadmap,
          name,
          version: opts.releaseVersion,
          status: opts.status,
          milestone_ids: splitList(opts.milestones),
          task_ids: resolveMany("tasks", splitList(opts.tasks)),
          plan_ids: resolveMany("plans", splitList(opts.plans)),
          run_ids: resolveMany("task_runs", splitList(opts.runs)),
          notes: opts.notes,
        });
        if (globalOpts.json) { output(release, true); return; }
        console.log(chalk.green(`Release group saved: ${release.name}`));
      } catch (e) {
        handleError(e);
      }
    });

  roadmaps
    .command("export <roadmap>")
    .description("Export a roadmap as JSON bundle or Markdown")
    .option("--format <format>", "json or markdown", "json")
    .option("--out <path>", "Write output to a file")
    .action(async (roadmap: string, opts: { format?: string; out?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { exportRoadmapBundle, renderRoadmapMarkdown } = await import("../../lib/roadmaps.js");
        const content = opts.format === "markdown" ? renderRoadmapMarkdown(roadmap) : JSON.stringify(exportRoadmapBundle(roadmap), null, 2);
        if (opts.out) {
          writeFileSync(opts.out, content);
          if (!(globalOpts.json)) console.log(chalk.green(`Wrote roadmap export to ${opts.out}`));
        }
        if (globalOpts.json) { output(opts.format === "markdown" ? { content } : JSON.parse(content), true); return; }
        if (!opts.out) console.log(content);
      } catch (e) {
        handleError(e);
      }
    });

  roadmaps
    .command("import <path>")
    .description("Preview or apply a roadmap JSON bundle")
    .option("--apply", "Apply the import")
    .action(async (path: string, opts: { apply?: boolean }) => {
      const globalOpts = globalOptions(program);
      try {
        const { importRoadmapBundle } = await import("../../lib/roadmaps.js");
        const bundle = JSON.parse(readFileSync(path, "utf8")) as RoadmapBundle;
        const result = importRoadmapBundle(bundle, { apply: Boolean(opts.apply) });
        if (globalOpts.json) { output(result, true); return; }
        console.log(result.applied ? chalk.green(`Imported roadmap ${result.roadmap_id}`) : chalk.dim(`Preview: ${result.milestones} milestones, ${result.releases} releases`));
      } catch (e) {
        handleError(e);
      }
    });
}
