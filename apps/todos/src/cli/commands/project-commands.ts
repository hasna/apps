import type { Command } from "commander";
import chalk from "chalk";
import { basename, resolve, sep } from "node:path";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import {
  createProject,
  deleteProject,
  listProjects,
  getProjectByPath,
  renameProject,
  updateProject,
} from "../../db/projects.js";
import { addComment } from "../../db/comments.js";
import { getTodosCloudClient, cloudAddComment, cloudCreateProject, cloudListProjects, cloudResolveProject, cloudUpdateProject, cloudAddDependency, cloudRemoveDependency, cloudGetDependencies, cloudRenameProject } from "../cloud-router.js";
import { searchTasks } from "../../lib/search.js";
import {
  deleteSearchView,
  listSearchViews,
  normalizeScope,
  runSavedSearch,
  runSearchView,
  saveSearchView,
  type SavedSearchFilters,
  type SavedSearchScope,
} from "../../lib/saved-search-views.js";
import { defaultSyncAgents, syncWithAgent, syncWithAgents } from "../../lib/sync.js";
import { getAgentTaskListId } from "../../lib/config.js";
import { autoProject, autoDetectProject, handleError, output, formatTaskLine, normalizeStatus, resolveExplicitProject, resolveTaskId, resolveTaskIdForCommand } from "../helpers.js";
import { redactBroadOutput, redactBroadTasks } from "../output-redaction.js";

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function splitList(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const items = values.flatMap((item) => item.split(",").map((part) => part.trim()).filter(Boolean));
  return items.length > 0 ? items : undefined;
}

function parseJsonObjectOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  throw new Error(`${label} must be a JSON object`);
}

function countProjectTasks(projectId: string): { total: number; incomplete: number } {
  const db = getDatabase();
  return db.query(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END), 0) AS incomplete
     FROM tasks
     WHERE project_id = ?`,
  ).get(projectId) as { total: number; incomplete: number };
}

function pathIsWithinPrefix(projectPath: string, prefix: string): boolean {
  const normalizedPath = resolve(projectPath);
  const normalizedPrefix = resolve(prefix);
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}${sep}`);
}

function resolveTaskListFilter(input: string | undefined, projectId?: string): string | undefined {
  if (!input) return undefined;
  const db = getDatabase();
  const id = input.length >= 36
    ? db.query("SELECT id FROM task_lists WHERE id = ?").get(input) as { id: string } | null
    : null;
  if (id) return id.id;

  if (input.length < 36) {
    const partialIds = db.query("SELECT id FROM task_lists WHERE id LIKE ?").all(`${input}%`) as { id: string }[];
    if (partialIds.length === 1) return partialIds[0]!.id;
    if (partialIds.length > 1) {
      throw new Error(`Ambiguous task list ID: ${input}`);
    }
  }

  if (projectId) {
    const projectSlug = db.query(
      "SELECT id FROM task_lists WHERE project_id = ? AND slug = ?",
    ).get(projectId, input) as { id: string } | null;
    if (projectSlug) return projectSlug.id;

    const standaloneSlug = db.query(
      "SELECT id FROM task_lists WHERE project_id IS NULL AND slug = ?",
    ).get(input) as { id: string } | null;
    if (standaloneSlug) return standaloneSlug.id;

    const otherProjectSlugs = db.query(
      "SELECT id FROM task_lists WHERE slug = ? LIMIT 2",
    ).all(input) as { id: string }[];
    if (otherProjectSlugs.length > 0) {
      throw new Error(`Task list slug "${input}" does not belong to the selected project`);
    }
  } else {
    const slugMatches = db.query("SELECT id FROM task_lists WHERE slug = ?").all(input) as { id: string }[];
    if (slugMatches.length === 1) return slugMatches[0]!.id;
    if (slugMatches.length > 1) {
      throw new Error(`Ambiguous task list slug: ${input}. Use --project or the task list ID.`);
    }
  }

  throw new Error(`Could not resolve task list ID: ${input}`);
}

function buildSearchFilters(query: string | undefined, opts: any, projectId?: string): SavedSearchFilters {
  const filterPatch = parseJsonObjectOption(opts.filter, "--filter");
  const customFields = parseJsonObjectOption(opts.fieldCustom, "--field-custom");
  const labels = splitList(opts.fieldLabel);
  const tags = splitList(opts.tag);
  const statuses = splitList(opts.status)?.map(normalizeStatus);
  const filters: SavedSearchFilters = {
    query: query || opts.query,
    project_id: opts.allProjects ? undefined : projectId,
    status: statuses,
    priority: splitList(opts.priority) as SavedSearchFilters["priority"],
    assigned_to: opts.assigned,
    agent_id: opts.agentId,
    task_list_id: filterPatch?.task_list_id === undefined
      ? resolveTaskListFilter(opts.taskList, projectId)
      : undefined,
    plan_id: opts.plan,
    task_id: opts.task,
    tags,
    created_after: opts.createdAfter,
    updated_after: opts.since || opts.updatedAfter,
    has_dependencies: opts.hasDeps ? true : undefined,
    is_blocked: opts.blocked ? true : undefined,
    depends_on: opts.dependsOn,
    blocks: opts.blocks,
    limit: opts.limit ? Number(opts.limit) : undefined,
    local_fields: labels || opts.fieldOwner || opts.fieldArea || opts.fieldSeverity || customFields
      ? {
        labels,
        owner: opts.fieldOwner,
        area: opts.fieldArea,
        severity: opts.fieldSeverity,
        custom: customFields,
      }
      : undefined,
    ...filterPatch,
  };
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)) as SavedSearchFilters;
}

export function registerProjectCommands(program: Command) {
  program
    .command("project-bootstrap [path]")
    .description("Discover a local workspace and initialize project task state")
    .option("--name <name>", "Project display name")
    .option("--task-list <slug>", "Default task list slug")
    .option("--route-enabled", "Mark the default task list as eligible for OpenLoops task-created routing")
    .option("--dry-run", "Show discovery without writing local state")
    .action(async (inputPath: string | undefined, opts) => {
      const globalOpts = program.opts();
      try {
        const { bootstrapProject } = await import("../../lib/project-bootstrap.js");
        const result = bootstrapProject({
          path: inputPath || globalOpts.project || process.cwd(),
          name: opts.name,
          taskListSlug: opts.taskList,
          routeEnabled: Boolean(opts.routeEnabled),
          dryRun: opts.dryRun,
        });

        if (globalOpts.json) {
          output(result, true);
          return;
        }

        console.log(chalk.bold("Project bootstrap"));
        console.log(`  ${chalk.dim("Path:")}       ${result.discovery.projectPath}`);
        console.log(`  ${chalk.dim("Name:")}       ${result.discovery.projectName}`);
        if (result.discovery.gitRoot) console.log(`  ${chalk.dim("Git root:")}   ${result.discovery.gitRoot}`);
        if (result.discovery.workspaceRoot) console.log(`  ${chalk.dim("Workspace:")}  ${result.discovery.workspaceRoot}`);
        if (result.dryRun) {
          console.log(chalk.dim("  Dry-run: no local state was changed."));
          return;
        }
        if (result.project) console.log(`  ${chalk.dim("Project:")}    ${result.project.id.slice(0, 8)} ${result.created.project ? "(created)" : "(existing)"}`);
        if (result.taskList) console.log(`  ${chalk.dim("Task list:")}  ${result.taskList.slug} ${result.created.taskList ? "(created)" : "(existing)"}`);
        if (result.taskList?.metadata.route_enabled === true) console.log(`  ${chalk.dim("Routing:")}    route-enabled`);
        if (result.created.sources.length > 0) {
          console.log(`  ${chalk.dim("Sources:")}    ${result.created.sources.join(", ")}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  // comment (aliased as log-progress so documented progress commands work)
  program
    .command("comment <id> <text>")
    .alias("log-progress")
    .description("Add a comment to a task (alias: log-progress, for recording intermediate progress)")
    .option("--pct <percent>", "Progress percentage (0-100) to record alongside the note")
    .action(async (id: string, text: string, opts: { pct?: string }) => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();
      const resolvedId = await resolveTaskIdForCommand(id, cloud);
      let content = text;
      let progressPct: number | undefined;
      if (opts.pct !== undefined) {
        const pct = parseInt(opts.pct, 10);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          console.error(chalk.red("--pct must be a number between 0 and 100"));
          process.exit(1);
        }
        content = `[progress ${pct}%] ${text}`;
        progressPct = pct;
      }
      try {
        const comment = cloud
          ? await cloudAddComment(cloud, resolvedId, {
              content,
              agent_id: globalOpts.agent,
              session_id: globalOpts.session,
              ...(progressPct !== undefined ? { type: "progress", progress_pct: progressPct } : {}),
            })
          : addComment({
              task_id: resolvedId,
              content,
              agent_id: globalOpts.agent,
              session_id: globalOpts.session,
            });

        if (globalOpts.json) {
          output(comment, true);
        } else {
          console.log(chalk.green("Comment added."));
        }
      } catch (e) {
        handleError(e);
      }
    });

  // search
  program
    .command("search <query>")
    .description("Search local tasks, or run/save a cross-entity search view")
    .option("--status <status>", "Filter by status")
    .option("--priority <p>", "Filter by priority")
    .option("--assigned <agent>", "Filter by assigned agent")
    .option("--agent-id <agent>", "Filter by creator/run/comment agent")
    .option("--task-list <id>", "Filter by task list")
    .option("--plan <id>", "Filter by plan")
    .option("--task <id>", "Filter runs/comments by task")
    .option("--tag <tag>", "Filter by task tag (repeatable or comma-separated)", collectOption, [])
    .option("--field-label <label>", "Filter by local field label (repeatable or comma-separated)", collectOption, [])
    .option("--field-owner <owner>", "Filter by local field owner")
    .option("--field-area <area>", "Filter by local field area")
    .option("--field-severity <severity>", "Filter by local field severity")
    .option("--field-custom <json>", "Filter by local custom fields as JSON")
    .option("--since <date>", "Only tasks updated after this date (ISO)")
    .option("--created-after <date>", "Only records created after this date (ISO)")
    .option("--blocked", "Only blocked tasks (incomplete dependencies)")
    .option("--has-deps", "Only tasks with dependencies")
    .option("--depends-on <id>", "Only tasks that depend on a task")
    .option("--blocks <id>", "Only tasks that block a task")
    .option("--scope <scope>", "Search scope: tasks, projects, plans, runs, comments, all", "tasks")
    .option("--limit <n>", "Maximum results", "100")
    .option("--filter <json>", "Merge an advanced saved-search filter JSON object")
    .option("--save-as <name>", "Save this search as a named view")
    .option("--description <text>", "Saved view description")
    .option("--all-projects", "Do not auto-scope the search to the current project")
    .action((query: string, opts) => {
      const globalOpts = program.opts();
      try {
        const projectId = opts.allProjects ? undefined : autoProject(globalOpts);
        const scope = normalizeScope(opts.scope) as SavedSearchScope;
        const searchOpts = buildSearchFilters(query, opts, projectId);
        if (opts.saveAs) {
          const view = saveSearchView({
            name: opts.saveAs,
            description: opts.description,
            scope,
            filters: searchOpts,
          });
          output(view, Boolean(globalOpts.json));
          if (!globalOpts.json) console.log(chalk.green(`Saved view ${view.name}.`));
          return;
        }
        if (scope !== "tasks") {
          const result = runSavedSearch(searchOpts, scope);
          if (globalOpts.json) {
            output(redactBroadOutput(result), true);
            return;
          }
          if (result.count === 0) {
            console.log(chalk.dim(`No ${scope} results matching "${query}".`));
            return;
          }
          console.log(chalk.bold(`${result.count} ${scope} result(s) for "${query}":\n`));
          for (const item of result.results) {
            const entity = redactBroadOutput(item.entity as any);
            console.log(`${chalk.cyan(item.entity_type)} ${entity.id?.slice?.(0, 8) || ""} ${entity.name || entity.title || entity.content || entity.summary || ""}`);
          }
          return;
        }
        const tasks = runSavedSearch(searchOpts, "tasks").results.map((item) => item.entity as ReturnType<typeof searchTasks>[number]);
        const outputTasks = redactBroadTasks(tasks);

        if (globalOpts.json) {
          output(outputTasks, true);
          return;
        }

        if (outputTasks.length === 0) {
          console.log(chalk.dim(`No tasks matching "${query}".`));
          return;
        }

        console.log(chalk.bold(`${outputTasks.length} result(s) for "${query}":\n`));
        for (const t of outputTasks) {
          console.log(formatTaskLine(t));
        }
      } catch (e) {
        handleError(e);
      }
    });

  const views = program
    .command("views")
    .description("Manage local saved search views");

  views
    .command("save <name>")
    .description("Save a local search view")
    .option("--query <query>", "Search query")
    .option("--scope <scope>", "Search scope: tasks, projects, plans, runs, comments, all", "tasks")
    .option("--description <text>", "Description")
    .option("--status <status>", "Filter by status")
    .option("--priority <p>", "Filter by priority")
    .option("--assigned <agent>", "Filter by assigned agent")
    .option("--agent-id <agent>", "Filter by creator/run/comment agent")
    .option("--task-list <id>", "Filter by task list")
    .option("--plan <id>", "Filter by plan")
    .option("--task <id>", "Filter runs/comments by task")
    .option("--tag <tag>", "Filter by task tag (repeatable or comma-separated)", collectOption, [])
    .option("--field-label <label>", "Filter by local field label (repeatable or comma-separated)", collectOption, [])
    .option("--field-owner <owner>", "Filter by local field owner")
    .option("--field-area <area>", "Filter by local field area")
    .option("--field-severity <severity>", "Filter by local field severity")
    .option("--field-custom <json>", "Filter by local custom fields as JSON")
    .option("--since <date>", "Only records updated after this date (ISO)")
    .option("--created-after <date>", "Only records created after this date (ISO)")
    .option("--blocked", "Only blocked tasks")
    .option("--has-deps", "Only tasks with dependencies")
    .option("--depends-on <id>", "Only tasks that depend on a task")
    .option("--blocks <id>", "Only tasks that block a task")
    .option("--limit <n>", "Maximum results", "100")
    .option("--filter <json>", "Merge an advanced saved-search filter JSON object")
    .option("--all-projects", "Do not auto-scope the view to the current project")
    .action((name: string, opts) => {
      const globalOpts = program.opts();
      try {
        const projectId = opts.allProjects ? undefined : autoProject(globalOpts);
        const view = saveSearchView({
          name,
          description: opts.description,
          scope: normalizeScope(opts.scope),
          filters: buildSearchFilters(opts.query, opts, projectId),
        });
        output(view, Boolean(globalOpts.json));
        if (!globalOpts.json) console.log(chalk.green(`Saved view ${view.name}.`));
      } catch (e) {
        handleError(e);
      }
    });

  views
    .command("list")
    .description("List local saved search views")
    .option("--scope <scope>", "Filter by scope")
    .action((opts) => {
      const globalOpts = program.opts();
      try {
        const rows = listSearchViews(opts.scope ? normalizeScope(opts.scope) : undefined);
        output(rows, Boolean(globalOpts.json));
        if (!globalOpts.json) {
          if (rows.length === 0) {
            console.log(chalk.dim("No saved search views."));
            return;
          }
          for (const row of rows) console.log(`${chalk.cyan(row.name)} ${chalk.dim(`[${row.scope}]`)} ${JSON.stringify(row.filters)}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  views
    .command("run <name>")
    .description("Run a local saved search view")
    .action((name: string) => {
      const globalOpts = program.opts();
      try {
        const result = runSearchView(name);
        if (globalOpts.json) {
          output(redactBroadOutput(result), true);
          return;
        }
        console.log(chalk.bold(`${result.count} result(s) for view "${result.view?.name || name}":\n`));
        for (const item of result.results) {
          if (item.entity_type === "tasks") {
            console.log(formatTaskLine(redactBroadOutput(item.entity as any)));
            continue;
          }
          const entity = redactBroadOutput(item.entity as any);
          console.log(`${chalk.cyan(item.entity_type)} ${entity.id?.slice?.(0, 8) || ""} ${entity.name || entity.title || entity.content || entity.summary || ""}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  views
    .command("delete <name>")
    .description("Delete a local saved search view")
    .action((name: string) => {
      const globalOpts = program.opts();
      try {
        const deleted = deleteSearchView(name);
        output({ deleted }, Boolean(globalOpts.json));
        if (!globalOpts.json) console.log(deleted ? chalk.green(`Deleted view ${name}.`) : chalk.dim(`View not found: ${name}`));
      } catch (e) {
        handleError(e);
      }
    });

  // deps
  program
    .command("deps <id>")
    .description("Manage task dependencies")
    .option("--needs <dep-id>", "Add dependency (this task needs dep-id)")
    .option("--remove <dep-id>", "Remove dependency")
    .option("--graph", "Show the dependency graph instead of direct edges")
    .option("--direction <direction>", "Graph direction: up, down, or both", "both")
    .action(async (id: string, opts) => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();

      // self_hosted cloud routing: dependency edges live on the SHARED dataset.
      // The previous path read LOCAL sqlite and 404'd cloud tasks. The recursive
      // `--graph` view is a local-only concept; in cloud mode we show the flat
      // dependency/blocked-by edges instead.
      if (cloud) {
        const cloudId = resolveTaskId(id);
        if (opts.needs) {
          try {
            const dep = await cloudAddDependency(cloud, cloudId, resolveTaskId(opts.needs));
            if (globalOpts.json) output(dep, true);
            else console.log(chalk.green("Dependency added."));
          } catch (e) { handleError(e); }
          return;
        }
        if (opts.remove) {
          const removed = await cloudRemoveDependency(cloud, cloudId, resolveTaskId(opts.remove));
          if (globalOpts.json) output({ removed }, true);
          else console.log(removed ? chalk.green("Dependency removed.") : chalk.red("Dependency not found."));
          return;
        }
        const edges = await cloudGetDependencies(cloud, cloudId);
        if (globalOpts.json) { output(edges, true); return; }
        if (edges.dependencies.length > 0) {
          console.log(chalk.bold("Depends on:"));
          for (const dep of edges.dependencies) console.log(`  ${chalk.cyan(dep.depends_on)}`);
        }
        if (edges.blocked_by.length > 0) {
          console.log(chalk.bold("Blocks:"));
          for (const b of edges.blocked_by) console.log(`  ${chalk.cyan(b.task_id)}`);
        }
        if (edges.dependencies.length === 0 && edges.blocked_by.length === 0) {
          console.log(chalk.dim("No dependencies."));
        }
        return;
      }

      const { addDependency, removeDependency, getTaskGraph, getTaskWithRelations } = await import("../../db/tasks.js");
      const resolvedId = resolveTaskId(id);

      if (opts.needs) {
        const depId = resolveTaskId(opts.needs);
        try {
          addDependency(resolvedId, depId);
        } catch (e) {
          console.error(chalk.red(e instanceof Error ? e.message : String(e)));
          process.exit(1);
        }
        if (globalOpts.json) {
          output({ task_id: resolvedId, depends_on: depId }, true);
        } else {
          console.log(chalk.green("Dependency added."));
        }
      } else if (opts.remove) {
        const depId = resolveTaskId(opts.remove);
        const removed = removeDependency(resolvedId, depId);
        if (globalOpts.json) {
          output({ removed }, true);
        } else {
          console.log(removed ? chalk.green("Dependency removed.") : chalk.red("Dependency not found."));
        }
      } else if (opts.graph) {
        const direction = opts.direction === "up" || opts.direction === "down" || opts.direction === "both"
          ? opts.direction
          : "both";
        const graph = getTaskGraph(resolvedId, direction);
        if (globalOpts.json) {
          output(graph, true);
          return;
        }

        const printNode = (node: typeof graph, depth: number, edge: "root" | "depends on" | "blocks") => {
          const indent = "  ".repeat(depth);
          const marker = edge === "root" ? "" : `${edge}: `;
          const blocked = node.task.is_blocked ? chalk.red(" blocked") : "";
          console.log(`${indent}${marker}${chalk.cyan(node.task.short_id || node.task.id.slice(0, 8))} ${node.task.title}${chalk.dim(` [${node.task.status}]`)}${blocked}`);
          for (const dep of node.depends_on) printNode(dep, depth + 1, "depends on");
          for (const dependent of node.blocks) printNode(dependent, depth + 1, "blocks");
        };

        printNode(graph, 0, "root");
      } else {
        // Show dependencies
        const task = getTaskWithRelations(resolvedId);
        if (!task) {
          console.error(chalk.red("Task not found."));
          process.exit(1);
        }

        if (globalOpts.json) {
          output({ dependencies: task.dependencies, blocked_by: task.blocked_by }, true);
          return;
        }

        if (task.dependencies.length > 0) {
          console.log(chalk.bold("Depends on:"));
          for (const dep of task.dependencies) {
            console.log(`  ${formatTaskLine(dep)}`);
          }
        }
        if (task.blocked_by.length > 0) {
          console.log(chalk.bold("Blocks:"));
          for (const b of task.blocked_by) {
            console.log(`  ${formatTaskLine(b)}`);
          }
        }
        if (task.dependencies.length === 0 && task.blocked_by.length === 0) {
          console.log(chalk.dim("No dependencies."));
        }
      }
    });

  // projects
  program
    .command("projects")
    .description("List and manage projects")
    .option("--add <path>", "Register a project by path")
    .option("--show <project>", "Resolve and show a project")
    .option("--update <project>", "Update a project's name, path, or description")
    .option("--deregister <project>", "Deregister a project without deleting its tasks; refuses projects with incomplete tasks")
    .option("--path-prefix <prefix>", "Require deregistered project path to start with this prefix")
    .option("--dry-run", "Show what would change without modifying local state")
    .option("--name <name>", "Project name (with --add)")
    .option("--path <path>", "Project path (with --update)")
    .option("--description <text>", "Project description (with --add or --update)")
    .option("--task-list-id <id>", "Custom task list ID (with --add)")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const cloud = getTodosCloudClient();

      if (opts.show) {
        const project = cloud ? await cloudResolveProject(cloud, opts.show) : resolveExplicitProject(opts.show);
        output(project, Boolean(globalOpts.json));
        return;
      }

      if (opts.update) {
        const patch = {
          ...(opts.name !== undefined ? { name: opts.name } : {}),
          ...(opts.path !== undefined ? { path: resolve(opts.path) } : {}),
          ...(opts.description !== undefined ? { description: opts.description } : {}),
        };
        if (Object.keys(patch).length === 0) {
          handleError(new Error("projects --update requires --name, --path, or --description"));
        }
        const current = cloud ? await cloudResolveProject(cloud, opts.update) : resolveExplicitProject(opts.update);
        const project = cloud
          ? await cloudUpdateProject(cloud, current.id, patch)
          : updateProject(current.id, patch);
        output(project, Boolean(globalOpts.json));
        return;
      }

      if (opts.deregister) {
        if (cloud) {
          handleError(new Error("REMOTE_COMMAND_UNSUPPORTED: projects --deregister has no safe /v1 equivalent; local SQLite fallback is disabled"));
        }
        const project = resolveExplicitProject(opts.deregister);
        const counts = countProjectTasks(project.id);

        if (opts.pathPrefix && !pathIsWithinPrefix(project.path, opts.pathPrefix)) {
          handleError(new Error(`Refusing to deregister ${project.name}: path ${project.path} is not within ${opts.pathPrefix}`));
        }

        if (counts.incomplete > 0) {
          handleError(new Error(`Refusing to deregister ${project.name}: ${counts.incomplete} incomplete task(s) remain`));
        }

        const result = {
          action: opts.dryRun ? "would_deregister" : "deregistered",
          project_id: project.id,
          name: project.name,
          path: project.path,
          total_tasks: counts.total,
          incomplete_tasks: counts.incomplete,
          tasks_preserved: true,
        };

        if (!opts.dryRun) {
          deleteProject(project.id);
        }

        if (globalOpts.json) {
          output(result, true);
        } else {
          console.log(chalk.green(`${opts.dryRun ? "Would deregister" : "Project deregistered"}: ${project.name} (${project.path})`));
          console.log(chalk.dim(`  Tasks preserved: ${counts.total}`));
        }
        return;
      }

      if (opts.add) {
        const projectPath = resolve(opts.add);
        const name = opts.name || basename(projectPath);
        const existing = cloud
          ? (await cloudListProjects(cloud)).find((project) => project.path === projectPath)
          : getProjectByPath(projectPath);
        let project;
        if (existing) {
          project = existing;
          if (opts.taskListId) {
            if (cloud && existing.task_list_id !== opts.taskListId) {
              handleError(new Error("Remote project task-list slug changes require project-rename"));
            }
            if (!cloud) project = renameProject(existing.id, { new_slug: opts.taskListId }).project;
          }
        } else {
          const input = { name, path: projectPath, description: opts.description, task_list_id: opts.taskListId };
          project = cloud ? await cloudCreateProject(cloud, input) : createProject(input);
        }
        // Auto-register machine-local path
        if (!cloud) {
          try {
            const { setMachineLocalPath } = await import("../../db/projects.js");
            setMachineLocalPath(project.id, projectPath);
          } catch {
            console.log(chalk.dim("  (machine path auto-register skipped)"));
          }
        }

        if (globalOpts.json) {
          output(project, true);
        } else {
          console.log(chalk.green(`Project registered: ${project.name} (${project.path})`));
          if (project.task_list_id) console.log(chalk.dim(`  Task list: ${project.task_list_id}`));
        }
        return;
      }

      const projects = cloud ? await cloudListProjects(cloud) : listProjects();
      if (globalOpts.json) {
        output(projects, true);
        return;
      }

      if (projects.length === 0) {
        console.log(chalk.dim("No projects registered."));
        return;
      }

      console.log(chalk.bold(`${projects.length} project(s):\n`));
      for (const p of projects) {
        const taskList = p.task_list_id ? chalk.cyan(` [${p.task_list_id}]`) : "";
        console.log(`${chalk.dim(p.id.slice(0, 8))} ${chalk.bold(p.name)} ${chalk.dim(p.path)}${taskList}${p.description ? ` - ${p.description}` : ""}`);
      }
    });

  program
    .command("project-panel")
    .description("Emit a contract-valid project dashboard panel for todos")
    .option("--project <project>", "Project path, id, task-list slug, or name. Defaults to the detected project")
    .option("--limit <n>", "Maximum panel items/resources", "20")
    .option("--contract", "Emit hasna.project_panel.v1 contract JSON")
    .option("-j, --json", "Output JSON")
    .action(async (opts: { project?: string; limit?: string; contract?: boolean; json?: boolean }) => {
      try {
        const globalOpts = program.opts();
        const project = opts.project ? resolveExplicitProject(opts.project) : autoDetectProject(globalOpts);
        if (!project) {
          console.error(chalk.red("Project not found: provide --project or run inside a registered project"));
          process.exit(1);
        }

        const { createTodosProjectPanel } = await import("../../lib/project-panel.js");
        const limit = opts.limit ? Number(opts.limit) : 20;
        const panel = createTodosProjectPanel(project.id, { limit });
        if (opts.json || opts.contract || globalOpts.json) {
          output(panel, true);
          return;
        }

        console.log(chalk.bold(`${panel.title}: ${project.name}`));
        console.log(panel.summary ?? chalk.dim("No summary."));
        for (const metric of panel.metrics) {
          console.log(`${chalk.dim(metric.id)} ${metric.value}${metric.unit ?? ""}`);
        }
      } catch (error) {
        handleError(error);
      }
    });

  // project rename
  program
    .command("project-rename <id-or-slug> <new-slug>")
    .description("Rename a project slug. Cascades to matching task lists. Task prefixes (e.g. APP-00001) are unchanged.")
    .option("--name <name>", "Also update the project display name")
    .option("-j, --json", "Output as JSON")
    .action(async (idOrSlug: string, newSlug: string, opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const cloud = getTodosCloudClient();
        let result;
        if (cloud) {
          result = await cloudRenameProject(cloud, idOrSlug, newSlug, opts.name);
        } else {
          const db = getDatabase();
          // Try resolve by ID first, then by task_list_id slug
          let resolvedId = resolvePartialId(db, "projects", idOrSlug);
          if (!resolvedId) {
            const bySlug = db.query("SELECT id FROM projects WHERE task_list_id = ?").get(idOrSlug) as { id: string } | null;
            resolvedId = bySlug?.id ?? null;
          }
          if (!resolvedId) {
            console.error(chalk.red(`Project not found: ${idOrSlug}`));
            process.exit(1);
          }
          result = renameProject(resolvedId, { name: opts.name, new_slug: newSlug });
        }
        if (useJson) {
          output({ project: result.project, task_lists_updated: result.task_lists_updated }, true);
        } else {
          console.log(chalk.green(`Project renamed: ${result.project.name} (slug: ${result.project.task_list_id})`));
          if (result.task_lists_updated > 0) {
            console.log(chalk.dim(`  Updated ${result.task_lists_updated} task list slug(s).`));
          }
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  // projects path — machine-local path overrides
  const projectsPathCmd = program
    .command("projects-path")
    .description("Manage machine-local path overrides for projects");

  projectsPathCmd
    .command("set <project-id> <path>")
    .description("Set the local path for a project on this machine")
    .option("-j, --json", "Output as JSON")
    .action(async (projectId: string, projectPath: string, opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const { setMachineLocalPath } = await import("../../db/projects.js");
        const db = getDatabase();
        const resolved = resolvePartialId(db, "projects", projectId);
        if (!resolved) { console.error(chalk.red(`Project not found: ${projectId}`)); process.exit(1); }
        const entry = setMachineLocalPath(resolved, resolve(projectPath));
        if (useJson) { output(entry, true); }
        else { console.log(chalk.green(`Local path set: ${entry.path} (machine: ${entry.machine_id.slice(0, 8)})`)); }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  projectsPathCmd
    .command("list <project-id>")
    .description("List all machine path overrides for a project")
    .option("-j, --json", "Output as JSON")
    .action(async (projectId: string, opts) => {
      const globalOpts = program.opts();
      const useJson = opts.json || globalOpts.json;
      try {
        const { listMachineLocalPaths } = await import("../../db/projects.js");
        const db = getDatabase();
        const resolved = resolvePartialId(db, "projects", projectId);
        if (!resolved) { console.error(chalk.red(`Project not found: ${projectId}`)); process.exit(1); }
        const paths = listMachineLocalPaths(resolved);
        if (useJson) { output(paths, true); return; }
        if (paths.length === 0) { console.log(chalk.dim("No machine path overrides.")); return; }
        for (const p of paths) {
          console.log(`${chalk.dim(p.machine_id.slice(0, 8))} ${p.path}  ${chalk.dim(p.updated_at)}`);
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  projectsPathCmd
    .command("remove <project-id>")
    .description("Remove the local path override for a project on this machine")
    .option("--machine <id>", "Machine ID to remove override for (default: this machine)")
    .action(async (projectId: string, opts) => {
      try {
        const { removeMachineLocalPath } = await import("../../db/projects.js");
        const db = getDatabase();
        const resolved = resolvePartialId(db, "projects", projectId);
        if (!resolved) { console.error(chalk.red(`Project not found: ${projectId}`)); process.exit(1); }
        const removed = removeMachineLocalPath(resolved, opts.machine);
        if (removed) { console.log(chalk.green("Machine path override removed.")); }
        else { console.log(chalk.dim("No override found to remove.")); }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  // extract
  program
    .command("extract <path>")
    .description("Extract TODO/FIXME/HACK/BUG/XXX/NOTE comments from source files and create tasks")
    .option("--dry-run", "Show extracted comments without creating tasks")
    .option("--pattern <tags>", "Comma-separated tags to look for (default: TODO,FIXME,HACK,XXX,BUG,NOTE)")
    .option("-t, --tags <tags>", "Extra comma-separated tags to add to created tasks")
    .option("--assign <agent>", "Assign extracted tasks to an agent")
    .option("--list <id>", "Task list ID")
    .option("--ext <extensions>", "Comma-separated file extensions to scan (e.g. ts,py,go)")
    .option("--exclude <patterns>", "Comma-separated gitignore-style path patterns to skip")
    .option("--no-gitignore", "Do not read .gitignore from the scanned root")
    .option("--index", "Include a local source index in JSON output")
    .action(async (scanPath: string, opts) => {
      try {
        const globalOpts = program.opts();
        const projectId = autoProject(globalOpts);
        const { extractTodos, EXTRACT_TAGS } = await import("../../lib/extract.js");
        const patterns = opts.pattern
          ? opts.pattern.split(",").map((t: string) => t.trim().toUpperCase()) as typeof EXTRACT_TAGS[number][]
          : undefined;
        const taskListId = opts.list ? resolveTaskListId(opts.list) : undefined;
        const result = extractTodos({
          path: resolve(scanPath),
          patterns,
          project_id: projectId,
          task_list_id: taskListId,
          tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
          assigned_to: opts.assign,
          agent_id: globalOpts.agent,
          dry_run: opts.dryRun,
          extensions: opts.ext ? opts.ext.split(",").map((e: string) => e.trim()) : undefined,
          exclude: splitList(opts.exclude),
          respect_gitignore: opts.gitignore !== false,
          include_index: Boolean(opts.index),
        });

        if (globalOpts.json) {
          console.log(JSON.stringify(opts.dryRun ? {
            comments: result.comments,
            index: result.index,
          } : {
            tasks_created: result.tasks.length,
            skipped: result.skipped,
            comments: result.comments.length,
            index: result.index,
          }, null, 2));
        } else if (opts.dryRun) {
          console.log(chalk.cyan(`Found ${result.comments.length} comment(s):\n`));
          for (const c of result.comments) {
            const symbol = c.symbol ? chalk.gray(` in ${c.symbol_kind || "symbol"} ${c.symbol}`) : "";
            console.log(`  ${chalk.yellow(`[${c.tag}]`)} ${c.message}${symbol}`);
            console.log(`    ${chalk.gray(`${c.file}:${c.line}`)}`);
          }
          if (result.index) {
            console.log(chalk.gray(`\nIndexed ${result.index.files.length} file(s), ${result.index.total_symbols} symbol(s).`));
          }
        } else {
          console.log(chalk.green(`Created ${result.tasks.length} task(s)`));
          if (result.skipped > 0) {
            console.log(chalk.gray(`Skipped ${result.skipped} duplicate(s)`));
          }
          console.log(chalk.gray(`Total comments found: ${result.comments.length}`));
          if (result.index) {
            console.log(chalk.gray(`Indexed ${result.index.files.length} file(s), ${result.index.total_symbols} symbol(s).`));
          }
          for (const t of result.tasks) {
            console.log(formatTaskLine(t));
          }
        }
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command("extract-watch <path>")
    .description("Poll a local source tree for TODO/FIXME/HACK/BUG/XXX/NOTE comments and create tasks")
    .option("--dry-run", "Show extracted comments without creating tasks")
    .option("--once", "Run a single watcher scan and exit", true)
    .option("--max-runs <n>", "Maximum watcher scans before exiting")
    .option("--interval <ms>", "Polling interval in milliseconds", "2000")
    .option("--pattern <tags>", "Comma-separated tags to look for")
    .option("-t, --tags <tags>", "Extra comma-separated tags to add to created tasks")
    .option("--assign <agent>", "Assign extracted tasks to an agent")
    .option("--list <id>", "Task list ID")
    .option("--ext <extensions>", "Comma-separated file extensions to scan")
    .option("--exclude <patterns>", "Comma-separated gitignore-style path patterns to skip")
    .option("--no-gitignore", "Do not read .gitignore from the watched root")
    .action(async (scanPath: string, opts) => {
      try {
        const globalOpts = program.opts();
        const projectId = autoProject(globalOpts);
        const { watchSourceTodos, EXTRACT_TAGS } = await import("../../lib/extract.js");
        const patterns = opts.pattern
          ? opts.pattern.split(",").map((t: string) => t.trim().toUpperCase()) as typeof EXTRACT_TAGS[number][]
          : undefined;
        const taskListId = opts.list ? resolveTaskListId(opts.list) : undefined;
        const maxRuns = opts.maxRuns ? parseInt(opts.maxRuns, 10) : 1;
        const result = await watchSourceTodos({
          path: resolve(scanPath),
          patterns,
          project_id: projectId,
          task_list_id: taskListId,
          tags: splitList(opts.tags),
          assigned_to: opts.assign,
          agent_id: globalOpts.agent,
          dry_run: opts.dryRun,
          extensions: splitList(opts.ext),
          exclude: splitList(opts.exclude),
          respect_gitignore: opts.gitignore !== false,
          include_index: true,
          once: opts.once !== false,
          max_runs: maxRuns,
          interval_ms: parseInt(opts.interval, 10),
        });

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        for (const run of result.runs) {
          console.log(chalk.cyan(`Watcher run ${run.run}: ${run.result.comments.length} comment(s), ${run.changed_files.length} changed file(s)`));
          if (!opts.dryRun) {
            console.log(chalk.green(`Created ${run.result.tasks.length} task(s), skipped ${run.result.skipped} duplicate(s)`));
          }
        }
      } catch (e) {
        handleError(e);
      }
    });

  // export
  program
    .command("export")
    .description("Export tasks")
    .option("-f, --format <format>", "Format: json, md, todos.md, or bridge", "json")
    .option("-o, --output <path>", "Write export output to a file")
    .option("--encrypt", "Encrypt bridge exports with a local encryption profile")
    .option("--encryption-profile <name>", "Encryption profile name", "default")
    .option("--allow-plaintext-sensitive", "Suppress plaintext bridge export warning")
    .action(async (opts) => {
      const { listTasks } = await import("../../db/tasks.js");
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);
      const writeOutput = async (content: string) => {
        if (opts.output) {
          const { writeFileSync } = await import("node:fs");
          writeFileSync(resolve(opts.output), content.endsWith("\n") ? content : `${content}\n`);
        } else {
          console.log(content);
        }
      };

      if (opts.format === "bridge") {
        const { createLocalBridgeBundle } = await import("../../lib/local-bridge.js");
        const { createEncryptedBridgeBundle } = await import("../../lib/local-encryption.js");
        const { emitLocalEventHooksQuiet } = await import("../../lib/event-hooks.js");
        const bundle = createLocalBridgeBundle({ project_id: projectId ?? undefined });
        const exported = opts.encrypt
          ? createEncryptedBridgeBundle(bundle, { profile: opts.encryptionProfile })
          : bundle;
        const json = JSON.stringify(exported, null, 2);
        await writeOutput(json);
        emitLocalEventHooksQuiet({ type: "export.finished", payload: { format: "bridge", encrypted: Boolean(opts.encrypt), project_id: projectId, output: opts.output ? resolve(opts.output) : null, stats: bundle.stats } });
        if (!opts.encrypt && !opts.allowPlaintextSensitive) {
          console.error(chalk.yellow("Warning: bridge exports are plaintext JSON. Use --encrypt for sensitive metadata, evidence, and artifact bundles."));
        }
        if (opts.output && !globalOpts.json) {
          console.log(chalk.green(`${opts.encrypt ? "Encrypted bridge export" : "Bridge export"} written to ${resolve(opts.output)}`));
        }
        return;
      }

      const tasks = listTasks(projectId ? { project_id: projectId } : {});
      const exportedCount = tasks.length;
      if (["md", "markdown", "todos.md", "todos-md"].includes(opts.format)) {
        const { exportTodosMarkdown } = await import("../../lib/todos-md.js");
        await writeOutput(exportTodosMarkdown({ project_id: projectId ?? undefined }));
      } else {
        await writeOutput(JSON.stringify(tasks, null, 2));
      }
      const { emitLocalEventHooksQuiet } = await import("../../lib/event-hooks.js");
      emitLocalEventHooksQuiet({ type: "export.finished", payload: { format: opts.format, project_id: projectId, output: opts.output ? resolve(opts.output) : null, count: exportedCount } });
    });

  program
    .command("bridge-import <file>")
    .description("Dry-run or apply a local hasna/todos bridge export bundle")
    .option("--apply", "Apply the import. Defaults to dry-run.")
    .option("--decrypt", "Decrypt an encrypted bridge export before importing")
    .option("--resolve-conflicts", "Safely merge existing local tasks by filling blank fields, unioning tags, and recording unresolved divergences")
    .action(async (file: string, opts) => {
      const globalOpts = program.opts();
      try {
        const { readFileSync } = await import("node:fs");
        const { importLocalBridgeBundle } = await import("../../lib/local-bridge.js");
        const { decryptBridgeBundle, isEncryptedBridgeBundle } = await import("../../lib/local-encryption.js");
        const parsed = JSON.parse(readFileSync(resolve(file), "utf-8"));
        const bundle = isEncryptedBridgeBundle(parsed)
          ? (opts.decrypt ? decryptBridgeBundle(parsed) : (() => { throw new Error("Bridge bundle is encrypted. Re-run with --decrypt and the configured key environment variable set."); })())
          : parsed;
        const result = importLocalBridgeBundle(bundle, { dryRun: !opts.apply, conflictStrategy: opts.resolveConflicts ? "safe_merge" : "skip" });
        const { emitLocalEventHooksQuiet } = await import("../../lib/event-hooks.js");
        emitLocalEventHooksQuiet({ type: "import.finished", payload: { file: resolve(file), dry_run: result.dry_run, ok: result.ok, inserted: result.inserted, skipped: result.skipped, conflicts: result.conflicts.length, issues: result.issues.length } });
        if (globalOpts.json) {
          output(result, true);
          return;
        }
        const mode = result.dry_run ? "Dry-run" : "Import";
        console.log(chalk.bold(`${mode} ${result.ok ? "ready" : "has issues"}`));
        for (const [key, count] of Object.entries(result.inserted)) {
          if (count > 0) console.log(`  ${key}: ${count}`);
        }
        for (const [key, count] of Object.entries(result.merged)) {
          if (count > 0) console.log(`  ${key} merged: ${count}`);
        }
        if (result.conflicts.length > 0) {
          console.log(chalk.yellow(`  conflicts: ${result.conflicts.length}`));
        }
        for (const issue of result.issues) {
          console.error(chalk.red(`  ${issue}`));
        }
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command("todos-md-import <file>")
    .alias("markdown-import")
    .alias("import-md")
    .description("Dry-run or apply a local todos.md Markdown import")
    .option("--apply", "Apply the import. Defaults to dry-run.")
    .option("--resolve-conflicts", "Safely merge embedded bridge task conflicts while preserving local divergent fields")
    .action(async (file: string, opts) => {
      const globalOpts = program.opts();
      try {
        const { readFileSync } = await import("node:fs");
        const { importTodosMarkdown } = await import("../../lib/todos-md.js");
        const result = importTodosMarkdown(readFileSync(resolve(file), "utf-8"), { dryRun: !opts.apply, conflictStrategy: opts.resolveConflicts ? "safe_merge" : "skip" });
        const { emitLocalEventHooksQuiet } = await import("../../lib/event-hooks.js");
        emitLocalEventHooksQuiet({ type: "import.finished", payload: { file: resolve(file), format: "todos.md", dry_run: result.dry_run, ok: result.ok, inserted: result.inserted, skipped: result.skipped, issues: result.issues.length } });
        if (globalOpts.json) {
          output(result, true);
          return;
        }
        const mode = result.dry_run ? "Dry-run" : "Import";
        console.log(chalk.bold(`${mode} ${result.ok ? "ready" : "has issues"}`));
        console.log(`  mode: ${result.mode}`);
        for (const [key, count] of Object.entries(result.inserted)) {
          if (count > 0) console.log(`  ${key}: ${count}`);
        }
        for (const [key, count] of Object.entries(result.merged)) {
          if (count > 0) console.log(`  ${key} merged: ${count}`);
        }
        for (const issue of result.issues) {
          console.error(chalk.red(`  ${issue}`));
        }
      } catch (e) {
        handleError(e);
      }
    });

  // sync
  program
    .command("sync")
    .description("Sync tasks with an agent task list (Claude uses native task list; others use JSON lists)")
    .option("--task-list <id>", "Task list ID (Claude auto-detects from CLAUDE_CODE_TASK_LIST_ID or CLAUDE_CODE_SESSION_ID)")
    .option("--agent <name>", "Agent/provider to sync (default: claude)")
    .option("--all", "Sync across all configured agents (TODOS_SYNC_AGENTS or default: claude,codex,gemini)")
    .option("--push", "One-way: push SQLite tasks to agent task list")
    .option("--pull", "One-way: pull agent task list into SQLite")
    .option("--prefer <side>", "Conflict strategy: local or remote", "remote")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const project = autoDetectProject(globalOpts);
      const projectId = project?.id;
      const direction = opts.push && !opts.pull ? "push" : opts.pull && !opts.push ? "pull" : "both";

      let result;
      const prefer = (opts.prefer as string | undefined) === "local" ? "local" : "remote";

      if (opts.all) {
        const agents = defaultSyncAgents();
        result = syncWithAgents(
          agents,
          (agent) => resolveTaskListForAgent(agent, opts.taskList, project?.task_list_id),
          projectId,
          direction,
          { prefer },
        );
      } else {
        const agent = (opts.agent as string | undefined) || "claude";
        const taskListId = resolveTaskListForAgent(agent, opts.taskList, project?.task_list_id);
        if (!taskListId) {
          console.error(chalk.red(`Could not detect task list ID for ${agent}. Use --task-list <id> or set appropriate env vars.`));
          process.exit(1);
        }
        result = syncWithAgent(agent, taskListId, projectId, direction, { prefer });
      }

      if (globalOpts.json) {
        output(result, true);
        return;
      }

      if (result.pulled > 0) console.log(chalk.green(`Pulled ${result.pulled} task(s).`));
      if (result.pushed > 0) console.log(chalk.green(`Pushed ${result.pushed} task(s).`));
      if (result.pulled === 0 && result.pushed === 0 && result.errors.length === 0) {
        console.log(chalk.dim("Nothing to sync."));
      }
      for (const err of result.errors) {
        console.error(chalk.red(`  Error: ${err}`));
      }
    });
}

// Helper from original index.tsx
function resolveTaskListForAgent(agent: string, explicit?: string, projectTaskListId?: string | null): string | null {
  if (explicit) return explicit;
  const normalized = agent.trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claude_code") {
    return process.env["TODOS_CLAUDE_TASK_LIST"]
      || process.env["CLAUDE_CODE_TASK_LIST_ID"]
      || process.env["CLAUDE_CODE_SESSION_ID"]
      || getAgentTaskListId(normalized)
      || projectTaskListId
      || null;
  }
  const key = `TODOS_${normalized.toUpperCase()}_TASK_LIST`;
  return process.env[key]
    || process.env["TODOS_TASK_LIST_ID"]
    || getAgentTaskListId(normalized)
    || "default";
}

function resolveTaskListId(partialId: string): string {
  const db = getDatabase();
  const id = resolvePartialId(db, "task_lists", partialId);
  if (!id) {
    console.error(chalk.red(`Could not resolve task list ID: ${partialId}`));
    process.exit(1);
  }
  return id;
}
