import type { Command } from "commander";
import chalk from "chalk";
import { basename, resolve } from "node:path";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import {
  createProject,
  listProjects,
  updateProject,
  getProjectByPath,
} from "../../db/projects.js";
import { addComment } from "../../db/comments.js";
import { searchTasks } from "../../lib/search.js";
import { defaultSyncAgents, syncWithAgent, syncWithAgents } from "../../lib/sync.js";
import { getAgentTaskListId } from "../../lib/config.js";
import { autoProject, autoDetectProject, handleError, output, formatTaskLine, normalizeStatus, resolveTaskId } from "../helpers.js";

export function registerProjectCommands(program: Command) {
  // comment
  program
    .command("comment <id> <text>")
    .description("Add a comment to a task")
    .action((id: string, text: string) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(id);
      const comment = addComment({
        task_id: resolvedId,
        content: text,
        agent_id: globalOpts.agent,
        session_id: globalOpts.session,
      });

      if (globalOpts.json) {
        output(comment, true);
      } else {
        console.log(chalk.green("Comment added."));
      }
    });

  // search
  program
    .command("search <query>")
    .description("Search tasks")
    .option("--status <status>", "Filter by status")
    .option("--priority <p>", "Filter by priority")
    .option("--assigned <agent>", "Filter by assigned agent")
    .option("--since <date>", "Only tasks updated after this date (ISO)")
    .option("--blocked", "Only blocked tasks (incomplete dependencies)")
    .option("--has-deps", "Only tasks with dependencies")
    .action((query: string, opts) => {
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);
      const searchOpts: any = { query, project_id: projectId };
      if (opts.status) searchOpts.status = normalizeStatus(opts.status);
      if (opts.priority) searchOpts.priority = opts.priority;
      if (opts.assigned) searchOpts.assigned_to = opts.assigned;
      if (opts.since) searchOpts.updated_after = opts.since;
      if (opts.blocked) searchOpts.is_blocked = true;
      if (opts.hasDeps) searchOpts.has_dependencies = true;
      const tasks = searchTasks(searchOpts);

      if (globalOpts.json) {
        output(tasks, true);
        return;
      }

      if (tasks.length === 0) {
        console.log(chalk.dim(`No tasks matching "${query}".`));
        return;
      }

      console.log(chalk.bold(`${tasks.length} result(s) for "${query}":\n`));
      for (const t of tasks) {
        console.log(formatTaskLine(t));
      }
    });

  // deps
  program
    .command("deps <id>")
    .description("Manage task dependencies")
    .option("--needs <dep-id>", "Add dependency (this task needs dep-id)")
    .option("--remove <dep-id>", "Remove dependency")
    .action(async (id: string, opts) => {
      const globalOpts = program.opts();
      const { addDependency, removeDependency, getTaskWithRelations } = await import("../../db/tasks.js");
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
    .option("--name <name>", "Project name (with --add)")
    .option("--task-list-id <id>", "Custom task list ID (with --add)")
    .action(async (opts) => {
      const globalOpts = program.opts();

      if (opts.add) {
        const projectPath = resolve(opts.add);
        const name = opts.name || basename(projectPath);
        const existing = getProjectByPath(projectPath);
        let project;
        if (existing) {
          project = existing;
          if (opts.taskListId) {
            project = updateProject(existing.id, { task_list_id: opts.taskListId });
          }
        } else {
          project = createProject({ name, path: projectPath, task_list_id: opts.taskListId });
        }
        // Auto-register machine-local path
        try {
          const { setMachineLocalPath } = await import("../../db/projects.js");
          setMachineLocalPath(project.id, projectPath);
        } catch (e) {
          console.log(chalk.dim("  (machine path auto-register skipped)"));
        }

        if (globalOpts.json) {
          output(project, true);
        } else {
          console.log(chalk.green(`Project registered: ${project.name} (${project.path})`));
          if (project.task_list_id) console.log(chalk.dim(`  Task list: ${project.task_list_id}`));
        }
        return;
      }

      const projects = listProjects();
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
        const { renameProject } = await import("../../db/projects.js");
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
        const result = renameProject(resolvedId, { name: opts.name, new_slug: newSlug });
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
        });

        if (globalOpts.json) {
          console.log(JSON.stringify(opts.dryRun ? { comments: result.comments } : { tasks_created: result.tasks.length, skipped: result.skipped, comments: result.comments.length }, null, 2));
        } else if (opts.dryRun) {
          console.log(chalk.cyan(`Found ${result.comments.length} comment(s):\n`));
          for (const c of result.comments) {
            console.log(`  ${chalk.yellow(`[${c.tag}]`)} ${c.message}`);
            console.log(`    ${chalk.gray(`${c.file}:${c.line}`)}`);
          }
        } else {
          console.log(chalk.green(`Created ${result.tasks.length} task(s)`));
          if (result.skipped > 0) {
            console.log(chalk.gray(`Skipped ${result.skipped} duplicate(s)`));
          }
          console.log(chalk.gray(`Total comments found: ${result.comments.length}`));
          for (const t of result.tasks) {
            console.log(formatTaskLine(t));
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
    .option("-f, --format <format>", "Format: json or md", "json")
    .action(async (opts) => {
      const { listTasks } = await import("../../db/tasks.js");
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);
      const tasks = listTasks(projectId ? { project_id: projectId } : {});

      if (opts.format === "md") {
        console.log("# Tasks\n");
        for (const t of tasks) {
          const check = t.status === "completed" ? "x" : " ";
          console.log(`- [${check}] **${t.title}** (${t.priority}) ${t.status}`);
          if (t.description) console.log(`  ${t.description}`);
        }
      } else {
        console.log(JSON.stringify(tasks, null, 2));
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
