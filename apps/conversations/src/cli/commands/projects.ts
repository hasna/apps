import type { Command } from "commander";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { createConversationsProjectPanel } from "../../lib/project-panel.js";
import { closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { previewText } from "../../lib/compact-output.js";
import { getCliWindow, getJsonWindow, pageFromQuery, printCompactFooter, printJsonDisclosure, queryLimitFor } from "../compact.js";
import { PROJECT_LIST_ORDER } from "../../lib/list-order.js";
import { emitCliError } from "../cli-error.js";
import { printErrorLine, printJson, printJsonLine, printLine } from "../../lib/stdout.js";

export function requireDeleteConfirmation(confirmed?: boolean): void {
  if (!confirmed) {
    throw new Error('Project deletion requires --yes confirmation');
  }
}

export function parseProjectListPagination(limitInput: unknown, offsetInput: unknown, cursorInput?: unknown): {
  limit: number | undefined;
  offset: number | undefined;
  cursor: number | undefined;
} {
  const parseInteger = (input: unknown, flag: "limit" | "offset" | "cursor"): number | undefined => {
    if (input === undefined) return undefined;

    const message = flag === "limit"
      ? "--limit must be a positive integer."
      : `--${flag} must be a non-negative integer.`;
    const pattern = flag === "limit" ? /^[1-9]\d*$/ : /^(?:0|[1-9]\d*)$/;

    if (typeof input === "string") {
      if (!pattern.test(input)) throw new Error(message);
      return Number(input);
    }

    if (typeof input !== "number" || !Number.isInteger(input) || (flag === "limit" ? input <= 0 : input < 0)) {
      throw new Error(message);
    }
    return input;
  };

  const limit = parseInteger(limitInput, "limit");
  const offset = parseInteger(offsetInput, "offset");
  const cursor = parseInteger(cursorInput, "cursor");
  return { limit, offset, cursor };
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
          printLine(chalk.bold(panel.title));
          if (panel.summary) printLine(`  ${panel.summary}`);
          printLine(`  State: ${panel.state}`);
          printLine(`  Items: ${panel.items.length}`);
        }
      } catch (e: any) {
        if (opts.json || opts.contract) {
          printJsonLine({ error: e.message });
        } else {
          printErrorLine(chalk.red(e.message));
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
          printLine(chalk.green(`Project "${p.name}" created`) + chalk.dim(` (id: ${p.id})`));
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
    .option("--limit <n>", "Limit results")
    .option("--offset <n>", "Skip first N results")
    .option("--cursor <n>", "Skip first N results for pagination")
    .option("--page-json", "Output a paged JSON envelope with has_more and next_cursor")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const status = opts.status === "active" || opts.status === "archived" ? opts.status : undefined;

      let limit: number | undefined;
      let offset: number | undefined;
      let parsedCursor: number | undefined;
      try {
        ({ limit, offset, cursor: parsedCursor } = parseProjectListPagination(opts.limit, opts.offset, opts.cursor));
      } catch (e: any) {
        emitCliError(e.message, opts);
      }
      const cursor = parsedCursor ?? offset ?? 0;
      const textWindow = getCliWindow({ limit, cursor });
      const pagedJsonWindow = opts.pageJson
        ? getJsonWindow({ limit, cursor, defaultLimit: 10 })
        : null;
      const legacyJsonWindow = opts.json && limit !== undefined
        ? getJsonWindow({ limit, cursor, defaultLimit: limit })
        : null;
      const queryWindow = pagedJsonWindow ?? legacyJsonWindow ?? (!opts.json ? textWindow : null);
      const projects = await getStore().listProjects({
        ...(status ? { status } : {}),
        ...(queryWindow ? { limit: queryLimitFor(queryWindow) } : {}),
        ...(cursor > 0 ? { offset: cursor } : {}),
      });
      const page = queryWindow
        ? pageFromQuery(projects, queryWindow)
        : { items: projects, count: projects.length, hasMore: false, nextCursor: null };

      if (opts.pageJson) {
        printJson({
          projects: page.items,
          count: page.count,
          cursor,
          limit: pagedJsonWindow!.limit,
          has_more: page.hasMore,
          next_cursor: page.nextCursor,
          sort: PROJECT_LIST_ORDER,
        });
      } else if (opts.json) {
        printJson(page.items);
        printJsonDisclosure({
          shown: page.count,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          sort: PROJECT_LIST_ORDER,
        });
      } else {
        if (projects.length === 0) {
          printLine(chalk.dim("No projects found."));
        } else {
          for (const p of page.items) {
            const desc = p.description ? chalk.dim(` - ${previewText(p.description, 90)}`) : "";
            const statusBadge = p.status === "archived" ? chalk.yellow(" [archived]") : "";
            printLine(`${chalk.bold(p.name)}${desc}${statusBadge}  ${p.channel_count} channels`);
          }
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: textWindow.limitCapped,
            sort: PROJECT_LIST_ORDER,
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
        printLine(chalk.bold(p.name));
        if (p.description) printLine(`  Description: ${p.description}`);
        if (p.path) printLine(`  Path: ${p.path}`);
        if (p.repository) printLine(`  Repository: ${p.repository}`);
        printLine(`  Status: ${p.status}`);
        printLine(`  Channels: ${p.channel_count}`);
        if (p.tags.length > 0) printLine(`  Tags: ${p.tags.join(", ")}`);
        printLine(`  Created by: ${p.created_by} on ${p.created_at.slice(0, 10)}`);
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
          printLine(chalk.green(`Project "${p.name}" updated.`));
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
          printLine(chalk.green(`Project deleted.`));
        }
      } catch (e: any) {
        if (opts.json) {
          printJsonLine({ id, deleted: false, error: e.message });
        } else {
          printErrorLine(chalk.red(e.message));
        }
        process.exit(1);
      }
      closeDb();
    });
}
