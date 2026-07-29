import type { Command } from "commander";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { createConversationsProjectPanel } from "../../lib/project-panel.js";
import { closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { previewText } from "../../lib/compact-output.js";
import { getCliWindow, pageFromQuery, printCompactFooter, queryLimitFor } from "../compact.js";
import { emitCliError } from "../cli-error.js";
import { printJson, printJsonLine } from "../stdout.js";

export function requireDeleteConfirmation(confirmed?: boolean): void {
  if (!confirmed) {
    throw new Error('Project deletion requires --yes confirmation');
  }
}

export function parseProjectListPagination(limitInput: unknown, offsetInput: unknown): {
  limit: number | undefined;
  offset: number | undefined;
} {
  if (limitInput !== undefined && (!Number.isFinite(limitInput) || Number(limitInput) <= 0)) {
    throw new Error('--limit must be a positive integer.');
  }
  if (offsetInput !== undefined && (!Number.isFinite(offsetInput) || Number(offsetInput) < 0)) {
    throw new Error('--offset must be a non-negative integer.');
  }

  const limit = Number.isFinite(limitInput) ? Math.floor(Number(limitInput)) : undefined;
  const offset = Number.isFinite(offsetInput) ? Math.floor(Number(offsetInput)) : undefined;
  return { limit, offset };
}

export function registerProjectCommands(program: Command): void {
  program
    .command("project-panel")
    .description("Emit a contract-valid project dashboard panel for conversations")
    .option("--project <project>", "Project slug, name, id, or #iproj-* channel", "conversations")
    .option("--limit <n>", "Maximum panel items/resources", parseInt, 20)
    .option("--contract", "Emit hasna.project_panel.v1 contract JSON")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      try {
        const panel = await createConversationsProjectPanel(opts.project, { limit: opts.limit });
        if (opts.json || opts.contract) {
          printJson(panel);
        } else {
          console.log(chalk.bold(panel.title));
          if (panel.summary) console.log(`  ${panel.summary}`);
          console.log(`  State: ${panel.state}`);
          console.log(`  Items: ${panel.items.length}`);
        }
      } catch (e: any) {
        if (opts.json || opts.contract) {
          printJsonLine({ error: e.message });
        } else {
          console.error(chalk.red(e.message));
        }
        process.exit(1);
      } finally {
        closeDb();
      }
    });

  const project = program
    .command("project")
    .description("Manage projects");

  project
    .command("create")
    .description("Create a new project")
    .argument("<name>", "Project name")
    .option("--description <text>", "Project description")
    .option("--path <path>", "Project path on disk")
    .option("--repository <url>", "Repository URL")
    .option("--tags <json>", "JSON array of tags")
    .option("--from <agent>", "Creator agent ID")
    .option("-j, --json", "Output as JSON")
    .action(async (name, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      const projectName = typeof name === "string" ? name.trim() : "";
      if (!agent) {
        emitCliError("Creator identity is required.", opts);
      }
      if (!projectName) {
        emitCliError("Project name cannot be empty.", opts);
      }

      let tags: string[] | undefined;
      if (opts.tags) {
        try {
          tags = JSON.parse(opts.tags);
        } catch {
          emitCliError("Invalid --tags JSON. Expected array of strings.", opts);
        }
      }

      try {
        const p = await getStore().createProject({
          name: projectName,
          created_by: agent,
          description: opts.description,
          path: opts.path,
          repository: opts.repository,
          tags,
        });
        if (opts.json) {
          printJson(p);
        } else {
          console.log(chalk.green(`Project "${p.name}" created`) + chalk.dim(` (id: ${p.id})`));
        }
      } catch (e: any) {
        if (e.message?.includes("UNIQUE constraint")) {
          emitCliError(`Project "${projectName}" already exists.`, opts);
        }
        emitCliError(e.message, opts);
      }
      closeDb();
    });

  project
    .command("list")
    .description("List all projects")
    .option("--status <status>", "Filter by status (active/archived)")
    .option("--limit <n>", "Limit results", parseInt)
    .option("--offset <n>", "Skip first N results", parseInt)
    .option("--cursor <n>", "Skip first N results for pagination", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const status = opts.status === "active" || opts.status === "archived" ? opts.status : undefined;

      let limit: number | undefined;
      let offset: number | undefined;
      try {
        ({ limit, offset } = parseProjectListPagination(opts.limit, opts.offset));
      } catch (e: any) {
        emitCliError(e.message, opts);
      }
      const cursor = opts.cursor ?? offset;
      const window = getCliWindow({ limit, cursor });
      const projects = await getStore().listProjects({
        ...(status ? { status } : {}),
        ...(opts.json ? (limit !== undefined ? { limit } : {}) : { limit: queryLimitFor(window) }),
        ...(opts.json ? (cursor !== undefined ? { offset: cursor } : {}) : { offset: window.offset }),
      });
      const page = opts.json
        ? { items: projects, count: projects.length, hasMore: false, nextCursor: null }
        : pageFromQuery(projects, window);

      if (opts.json) {
        printJson(projects);
      } else {
        if (projects.length === 0) {
          console.log(chalk.dim("No projects found."));
        } else {
          for (const p of page.items) {
            const desc = p.description ? chalk.dim(` - ${previewText(p.description, 90)}`) : "";
            const statusBadge = p.status === "archived" ? chalk.yellow(" [archived]") : "";
            console.log(`${chalk.bold(p.name)}${desc}${statusBadge}  ${p.channel_count} channels`);
          }
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
            detailHint: "Use conversations project get <id-or-name> for details.",
          });
        }
      }
      closeDb();
    });

  project
    .command("get")
    .description("Get project details")
    .argument("<id-or-name>", "Project ID or name")
    .option("-j, --json", "Output as JSON")
    .action(async (idOrName, opts) => {
      let p = await getStore().getProject(idOrName);
      if (!p) p = await getStore().getProjectByName(idOrName);

      if (!p) {
        emitCliError(`Project "${idOrName}" not found.`, opts);
      }

      if (opts.json) {
        printJson(p);
      } else {
        console.log(chalk.bold(p.name));
        if (p.description) console.log(`  Description: ${p.description}`);
        if (p.path) console.log(`  Path: ${p.path}`);
        if (p.repository) console.log(`  Repository: ${p.repository}`);
        console.log(`  Status: ${p.status}`);
        console.log(`  Channels: ${p.channel_count}`);
        if (p.tags.length > 0) console.log(`  Tags: ${p.tags.join(", ")}`);
        console.log(`  Created by: ${p.created_by} on ${p.created_at.slice(0, 10)}`);
      }
      closeDb();
    });

  project
    .command("update")
    .description("Update a project")
    .argument("<id-or-name>", "Project ID or name")
    .option("--name <name>", "New name")
    .option("--description <text>", "New description")
    .option("--path <path>", "New path")
    .option("--status <status>", "New status (active/archived)")
    .option("--repository <url>", "New repository URL")
    .option("--tags <json>", "New tags (JSON array)")
    .option("-j, --json", "Output as JSON")
    .action(async (id, opts) => {
      const updates: Record<string, unknown> = {};
      if (opts.name) updates.name = opts.name;
      if (opts.description) updates.description = opts.description;
      if (opts.path) updates.path = opts.path;
      if (opts.status) updates.status = opts.status;
      if (opts.repository) updates.repository = opts.repository;
      if (opts.tags) {
        try {
          updates.tags = JSON.parse(opts.tags);
        } catch {
          emitCliError("Invalid --tags JSON.", opts);
        }
      }

      try {
        // Resolve by name if not a UUID
        const isUuid = /^[0-9a-f-]{36}$/i.test(id);
        const resolvedId = isUuid ? id : ((await getStore().getProjectByName(id))?.id ?? id);
        const p = await getStore().updateProject(resolvedId, updates as any);
        if (opts.json) {
          printJson(p);
        } else {
          console.log(chalk.green(`Project "${p.name}" updated.`));
        }
      } catch (e: any) {
        emitCliError(e.message, opts);
      }
      closeDb();
    });

  project
    .command("delete")
    .description("Delete a project")
    .argument("<id-or-name>", "Project ID or name")
    .option("--yes", "Confirm project deletion")
    .option("-j, --json", "Output as JSON")
    .action(async (id, opts) => {
      try {
        requireDeleteConfirmation(opts.yes);
        const isUuid = /^[0-9a-f-]{36}$/i.test(id);
        const resolvedId = isUuid ? id : ((await getStore().getProjectByName(id))?.id ?? id);
        const deleted = await getStore().deleteProject(resolvedId);
        if (!deleted) {
          throw new Error(`Project "${id}" not found.`);
        }
        if (opts.json) {
          printJsonLine({ id, deleted: true });
        } else {
          console.log(chalk.green(`Project deleted.`));
        }
      } catch (e: any) {
        if (opts.json) {
          printJsonLine({ id, deleted: false, error: e.message });
        } else {
          console.error(chalk.red(e.message));
        }
        process.exit(1);
      }
      closeDb();
    });
}
