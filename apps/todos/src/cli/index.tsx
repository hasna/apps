#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabase, resolvePartialId } from "../db/database.js";
import {
  createTask,
  getTask,
  getTaskWithRelations,
  listTasks,
  updateTask,
  deleteTask,
  startTask,
  completeTask,
  lockTask,
  unlockTask,
  addDependency,
  removeDependency,
} from "../db/tasks.js";
import {
  createProject,
  listProjects,
  updateProject,
  ensureProject,
  getProjectByPath,
} from "../db/projects.js";
import { registerAgent, listAgents } from "../db/agents.js";
import { createTaskList, listTaskLists, deleteTaskList } from "../db/task-lists.js";
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
} from "../db/plans.js";
import { addComment } from "../db/comments.js";
import { searchTasks } from "../lib/search.js";
import { defaultSyncAgents, syncWithAgent, syncWithAgents } from "../lib/sync.js";
import { getAgentTaskListId } from "../lib/config.js";
import type { Project, Task, TaskStatus, TaskPriority } from "../types/index.js";

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

// Helpers

function handleError(e: unknown): never {
  console.error(chalk.red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
}

function resolveTaskId(partialId: string): string {
  const db = getDatabase();
  const id = resolvePartialId(db, "tasks", partialId);
  if (!id) {
    console.error(chalk.red(`Could not resolve task ID: ${partialId}`));
    process.exit(1);
  }
  return id;
}

function detectGitRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function autoDetectProject(opts: { project?: string }): Project | undefined {
  if (opts.project) {
    return getProjectByPath(resolve(opts.project)) ?? undefined;
  }
  if (process.env["TODOS_AUTO_PROJECT"] === "false") return undefined;
  const gitRoot = detectGitRoot();
  if (gitRoot) {
    return ensureProject(basename(gitRoot), gitRoot);
  }
  return undefined;
}

function autoProject(opts: { project?: string }): string | undefined {
  return autoDetectProject(opts)?.id;
}

function output(data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  }
}

const statusColors: Record<string, (s: string) => string> = {
  pending: chalk.yellow,
  in_progress: chalk.blue,
  completed: chalk.green,
  failed: chalk.red,
  cancelled: chalk.gray,
};

const priorityColors: Record<string, (s: string) => string> = {
  critical: chalk.red.bold,
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.gray,
};

function formatTaskLine(t: Task): string {
  const statusFn = statusColors[t.status] || chalk.white;
  const priorityFn = priorityColors[t.priority] || chalk.white;
  const lock = t.locked_by ? chalk.magenta(` [locked:${t.locked_by}]`) : "";
  const assigned = t.assigned_to ? chalk.cyan(` -> ${t.assigned_to}`) : "";
  const tags = t.tags.length > 0 ? chalk.dim(` [${t.tags.join(",")}]`) : "";
  const plan = t.plan_id ? chalk.magenta(` [plan:${t.plan_id.slice(0, 8)}]`) : "";
  return `${chalk.dim(t.id.slice(0, 8))} ${statusFn(t.status.padEnd(11))} ${priorityFn(t.priority.padEnd(8))} ${t.title}${assigned}${lock}${tags}${plan}`;
}

// Global options
program
  .name("todos")
  .description("Universal task management for AI coding agents")
  .version(getPackageVersion())
  .option("--project <path>", "Project path")
  .option("--json", "Output as JSON")
  .option("--agent <name>", "Agent name")
  .option("--session <id>", "Session ID");

// === COMMANDS ===

// add
program
  .command("add <title>")
  .description("Create a new task")
  .option("-d, --description <text>", "Task description")
  .option("-p, --priority <level>", "Priority: low, medium, high, critical")
  .option("--parent <id>", "Parent task ID")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--plan <id>", "Assign to a plan")
  .option("--assign <agent>", "Assign to agent")
  .option("--status <status>", "Initial status")
  .option("--list <id>", "Task list ID")
  .action((title: string, opts) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);
    const taskListId = opts.list ? (() => {
      const db = getDatabase();
      const id = resolvePartialId(db, "task_lists", opts.list);
      if (!id) {
        console.error(chalk.red(`Could not resolve task list ID: ${opts.list}`));
        process.exit(1);
      }
      return id;
    })() : undefined;
    const task = createTask({
      title,
      description: opts.description,
      priority: opts.priority as TaskPriority | undefined,
      parent_id: opts.parent ? resolveTaskId(opts.parent) : undefined,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
      plan_id: opts.plan ? (() => {
        const db = getDatabase();
        const id = resolvePartialId(db, "plans", opts.plan);
        if (!id) {
          console.error(chalk.red(`Could not resolve plan ID: ${opts.plan}`));
          process.exit(1);
        }
        return id;
      })() : undefined,
      assigned_to: opts.assign,
      status: opts.status as TaskStatus | undefined,
      task_list_id: taskListId,
      agent_id: globalOpts.agent,
      session_id: globalOpts.session,
      project_id: projectId,
      working_dir: process.cwd(),
    });

    if (globalOpts.json) {
      output(task, true);
    } else {
      console.log(chalk.green("Task created:"));
      console.log(formatTaskLine(task));
    }
  });

// list
program
  .command("list")
  .description("List tasks")
  .option("-s, --status <status>", "Filter by status")
  .option("-p, --priority <priority>", "Filter by priority")
  .option("--assigned <agent>", "Filter by assigned agent")
  .option("--tags <tags>", "Filter by tags (comma-separated)")
  .option("-a, --all", "Show all tasks (including completed/cancelled)")
  .option("--list <id>", "Filter by task list ID")
  .action((opts) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);

    const filter: Record<string, unknown> = {};
    if (projectId) filter["project_id"] = projectId;
    if (opts.list) {
      const db = getDatabase();
      const listId = resolvePartialId(db, "task_lists", opts.list);
      if (!listId) {
        console.error(chalk.red(`Could not resolve task list ID: ${opts.list}`));
        process.exit(1);
      }
      filter["task_list_id"] = listId;
    }
    if (opts.status) {
      filter["status"] = opts.status.includes(",")
        ? opts.status.split(",").map((s: string) => s.trim())
        : opts.status;
    } else if (!opts.all) {
      filter["status"] = ["pending", "in_progress"];
    }
    if (opts.priority) filter["priority"] = opts.priority;
    if (opts.assigned) filter["assigned_to"] = opts.assigned;
    if (opts.tags) filter["tags"] = opts.tags.split(",").map((t: string) => t.trim());

    const tasks = listTasks(filter as any);

    if (globalOpts.json) {
      output(tasks, true);
      return;
    }

    if (tasks.length === 0) {
      console.log(chalk.dim("No tasks found."));
      return;
    }

    console.log(chalk.bold(`${tasks.length} task(s):\n`));
    for (const t of tasks) {
      console.log(formatTaskLine(t));
    }
  });

// show
program
  .command("show <id>")
  .description("Show full task details")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const task = getTaskWithRelations(resolvedId);

    if (!task) {
      console.error(chalk.red(`Task not found: ${id}`));
      process.exit(1);
    }

    if (globalOpts.json) {
      output(task, true);
      return;
    }

    console.log(chalk.bold("Task Details:\n"));
    console.log(`  ${chalk.dim("ID:")}       ${task.id}`);
    console.log(`  ${chalk.dim("Title:")}    ${task.title}`);
    console.log(`  ${chalk.dim("Status:")}   ${(statusColors[task.status] || chalk.white)(task.status)}`);
    console.log(`  ${chalk.dim("Priority:")} ${(priorityColors[task.priority] || chalk.white)(task.priority)}`);
    if (task.description) console.log(`  ${chalk.dim("Desc:")}     ${task.description}`);
    if (task.assigned_to) console.log(`  ${chalk.dim("Assigned:")} ${task.assigned_to}`);
    if (task.agent_id) console.log(`  ${chalk.dim("Agent:")}    ${task.agent_id}`);
    if (task.session_id) console.log(`  ${chalk.dim("Session:")}  ${task.session_id}`);
    if (task.locked_by) console.log(`  ${chalk.dim("Locked:")}   ${task.locked_by} (at ${task.locked_at})`);
    if (task.project_id) console.log(`  ${chalk.dim("Project:")}  ${task.project_id}`);
    if (task.plan_id) console.log(`  ${chalk.dim("Plan:")}     ${task.plan_id}`);
    if (task.working_dir) console.log(`  ${chalk.dim("WorkDir:")}  ${task.working_dir}`);
    if (task.parent) console.log(`  ${chalk.dim("Parent:")}   ${task.parent.id.slice(0, 8)} | ${task.parent.title}`);
    if (task.tags.length > 0) console.log(`  ${chalk.dim("Tags:")}     ${task.tags.join(", ")}`);
    console.log(`  ${chalk.dim("Version:")}  ${task.version}`);
    console.log(`  ${chalk.dim("Created:")}  ${task.created_at}`);
    if (task.completed_at) console.log(`  ${chalk.dim("Done:")}     ${task.completed_at}`);

    if (task.subtasks.length > 0) {
      console.log(chalk.bold(`\n  Subtasks (${task.subtasks.length}):`));
      for (const st of task.subtasks) {
        console.log(`    ${formatTaskLine(st)}`);
      }
    }

    if (task.dependencies.length > 0) {
      console.log(chalk.bold(`\n  Depends on (${task.dependencies.length}):`));
      for (const dep of task.dependencies) {
        console.log(`    ${formatTaskLine(dep)}`);
      }
    }

    if (task.blocked_by.length > 0) {
      console.log(chalk.bold(`\n  Blocks (${task.blocked_by.length}):`));
      for (const b of task.blocked_by) {
        console.log(`    ${formatTaskLine(b)}`);
      }
    }

    if (task.comments.length > 0) {
      console.log(chalk.bold(`\n  Comments (${task.comments.length}):`));
      for (const c of task.comments) {
        const agent = c.agent_id ? chalk.cyan(`[${c.agent_id}] `) : "";
        console.log(`    ${agent}${chalk.dim(c.created_at)}: ${c.content}`);
      }
    }
  });

// update
program
  .command("update <id>")
  .description("Update a task")
  .option("--title <text>", "New title")
  .option("-d, --description <text>", "New description")
  .option("-s, --status <status>", "New status")
  .option("-p, --priority <priority>", "New priority")
  .option("--assign <agent>", "Assign to agent")
  .option("--tags <tags>", "New tags (comma-separated)")
  .option("--list <id>", "Move to a task list")
  .action((id: string, opts) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const current = getTask(resolvedId);
    if (!current) {
      console.error(chalk.red(`Task not found: ${id}`));
      process.exit(1);
    }

    const taskListId = opts.list ? (() => {
      const db = getDatabase();
      const resolved = resolvePartialId(db, "task_lists", opts.list);
      if (!resolved) {
        console.error(chalk.red(`Could not resolve task list ID: ${opts.list}`));
        process.exit(1);
      }
      return resolved;
    })() : undefined;

    let task;
    try {
      task = updateTask(resolvedId, {
        version: current.version,
        title: opts.title,
        description: opts.description,
        status: opts.status as TaskStatus | undefined,
        priority: opts.priority as TaskPriority | undefined,
        assigned_to: opts.assign,
        tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined,
        task_list_id: taskListId,
      });
    } catch (e) {
      handleError(e);
    }

    if (globalOpts.json) {
      output(task, true);
    } else {
      console.log(chalk.green("Task updated:"));
      console.log(formatTaskLine(task));
    }
  });

// done
program
  .command("done <id>")
  .description("Mark a task as completed")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    let task;
    try {
      task = completeTask(resolvedId, globalOpts.agent);
    } catch (e) {
      handleError(e);
    }

    if (globalOpts.json) {
      output(task, true);
    } else {
      console.log(chalk.green("Task completed:"));
      console.log(formatTaskLine(task));
    }
  });

// start
program
  .command("start <id>")
  .description("Claim, lock, and start a task")
  .action((id: string) => {
    const globalOpts = program.opts();
    const agentId = globalOpts.agent || "cli";
    const resolvedId = resolveTaskId(id);
    let task;
    try {
      task = startTask(resolvedId, agentId);
    } catch (e) {
      handleError(e);
    }

    if (globalOpts.json) {
      output(task, true);
    } else {
      console.log(chalk.green(`Task started by ${agentId}:`));
      console.log(formatTaskLine(task));
    }
  });

// lock
program
  .command("lock <id>")
  .description("Acquire exclusive lock on a task")
  .action((id: string) => {
    const globalOpts = program.opts();
    const agentId = globalOpts.agent || "cli";
    const resolvedId = resolveTaskId(id);
    let result;
    try {
      result = lockTask(resolvedId, agentId);
    } catch (e) {
      handleError(e);
    }

    if (globalOpts.json) {
      output(result, true);
    } else if (result.success) {
      console.log(chalk.green(`Lock acquired by ${agentId}`));
    } else {
      console.error(chalk.red(`Lock failed: ${result.error}`));
      process.exit(1);
    }
  });

// unlock
program
  .command("unlock <id>")
  .description("Release lock on a task")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    try {
      unlockTask(resolvedId, globalOpts.agent);
    } catch (e) {
      handleError(e);
    }

    if (globalOpts.json) {
      output({ success: true }, true);
    } else {
      console.log(chalk.green("Lock released."));
    }
  });

// delete
program
  .command("delete <id>")
  .description("Delete a task")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const deleted = deleteTask(resolvedId);

    if (globalOpts.json) {
      output({ deleted }, true);
    } else if (deleted) {
      console.log(chalk.green("Task deleted."));
    } else {
      console.error(chalk.red("Task not found."));
      process.exit(1);
    }
  });

// plans
program
  .command("plans")
  .description("List and manage plans")
  .option("--add <name>", "Create a plan")
  .option("-d, --description <text>", "Plan description (with --add)")
  .option("--show <id>", "Show plan details with its tasks")
  .option("--delete <id>", "Delete a plan")
  .option("--complete <id>", "Mark a plan as completed")
  .action((opts) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);

    if (opts.add) {
      const plan = createPlan({
        name: opts.add,
        description: opts.description,
        project_id: projectId,
      });

      if (globalOpts.json) {
        output(plan, true);
      } else {
        console.log(chalk.green("Plan created:"));
        console.log(`${chalk.dim(plan.id.slice(0, 8))} ${chalk.bold(plan.name)} ${chalk.cyan(`[${plan.status}]`)}`);
      }
      return;
    }

    if (opts.show) {
      const db = getDatabase();
      const resolvedId = resolvePartialId(db, "plans", opts.show);
      if (!resolvedId) {
        console.error(chalk.red(`Could not resolve plan ID: ${opts.show}`));
        process.exit(1);
      }
      const plan = getPlan(resolvedId);
      if (!plan) {
        console.error(chalk.red(`Plan not found: ${opts.show}`));
        process.exit(1);
      }
      const tasks = listTasks({ plan_id: resolvedId });

      if (globalOpts.json) {
        output({ plan, tasks }, true);
        return;
      }

      console.log(chalk.bold("Plan Details:\n"));
      console.log(`  ${chalk.dim("ID:")}       ${plan.id}`);
      console.log(`  ${chalk.dim("Name:")}     ${plan.name}`);
      console.log(`  ${chalk.dim("Status:")}   ${chalk.cyan(plan.status)}`);
      if (plan.description) console.log(`  ${chalk.dim("Desc:")}     ${plan.description}`);
      if (plan.project_id) console.log(`  ${chalk.dim("Project:")}  ${plan.project_id}`);
      console.log(`  ${chalk.dim("Created:")}  ${plan.created_at}`);

      if (tasks.length > 0) {
        console.log(chalk.bold(`\n  Tasks (${tasks.length}):`));
        for (const t of tasks) {
          console.log(`    ${formatTaskLine(t)}`);
        }
      } else {
        console.log(chalk.dim("\n  No tasks in this plan."));
      }
      return;
    }

    if (opts.delete) {
      const db = getDatabase();
      const resolvedId = resolvePartialId(db, "plans", opts.delete);
      if (!resolvedId) {
        console.error(chalk.red(`Could not resolve plan ID: ${opts.delete}`));
        process.exit(1);
      }
      const deleted = deletePlan(resolvedId);
      if (globalOpts.json) {
        output({ deleted }, true);
      } else if (deleted) {
        console.log(chalk.green("Plan deleted."));
      } else {
        console.error(chalk.red("Plan not found."));
        process.exit(1);
      }
      return;
    }

    if (opts.complete) {
      const db = getDatabase();
      const resolvedId = resolvePartialId(db, "plans", opts.complete);
      if (!resolvedId) {
        console.error(chalk.red(`Could not resolve plan ID: ${opts.complete}`));
        process.exit(1);
      }
      try {
        const plan = updatePlan(resolvedId, { status: "completed" });
        if (globalOpts.json) {
          output(plan, true);
        } else {
          console.log(chalk.green("Plan completed:"));
          console.log(`${chalk.dim(plan.id.slice(0, 8))} ${chalk.bold(plan.name)} ${chalk.cyan(`[${plan.status}]`)}`);
        }
      } catch (e) {
        handleError(e);
      }
      return;
    }

    // Default: list plans
    const plans = listPlans(projectId);

    if (globalOpts.json) {
      output(plans, true);
      return;
    }

    if (plans.length === 0) {
      console.log(chalk.dim("No plans found."));
      return;
    }

    console.log(chalk.bold(`${plans.length} plan(s):\n`));
    for (const p of plans) {
      const desc = p.description ? chalk.dim(` - ${p.description}`) : "";
      console.log(`${chalk.dim(p.id.slice(0, 8))} ${chalk.bold(p.name)} ${chalk.cyan(`[${p.status}]`)}${desc}`);
    }
  });

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
  .action((query: string) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);
    const tasks = searchTasks(query, projectId);

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
  .action((id: string, opts) => {
    const globalOpts = program.opts();
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
  .action((opts) => {
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

// export
program
  .command("export")
  .description("Export tasks")
  .option("-f, --format <format>", "Format: json or md", "json")
  .action((opts) => {
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

function resolveTaskListId(agent: string, explicit?: string, projectTaskListId?: string | null): string | null {
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

program
  .command("sync")
  .description("Sync tasks with an agent task list (Claude uses native task list; others use JSON lists)")
  .option("--task-list <id>", "Task list ID (Claude auto-detects from CLAUDE_CODE_TASK_LIST_ID or CLAUDE_CODE_SESSION_ID)")
  .option("--agent <name>", "Agent/provider to sync (default: claude)")
  .option("--all", "Sync across all configured agents (TODOS_SYNC_AGENTS or default: claude,codex,gemini)")
  .option("--push", "One-way: push SQLite tasks to agent task list")
  .option("--pull", "One-way: pull agent task list into SQLite")
  .option("--prefer <side>", "Conflict strategy: local or remote", "remote")
  .action((opts) => {
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
        (agent) => resolveTaskListId(agent, opts.taskList, project?.task_list_id),
        projectId,
        direction,
        { prefer },
      );
    } else {
      const agent = (opts.agent as string | undefined) || "claude";
      const taskListId = resolveTaskListId(agent, opts.taskList, project?.task_list_id);
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

// hooks
const hooks = program
  .command("hooks")
  .description("Manage Claude Code hook integration");

hooks
  .command("install")
  .description("Install Claude Code hooks for auto-sync")
  .action(() => {
    // Resolve the todos binary path
    let todosBin = "todos";
    try {
      const p = execSync("which todos", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (p) todosBin = p;
    } catch { /* use default */ }

    // Create hook script — uses session ID if available, otherwise project-based auto-detection
    const hooksDir = join(process.cwd(), ".claude", "hooks");
    if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

    const hookScript = `#!/usr/bin/env bash
# Auto-generated by: todos hooks install
# Syncs todos with Claude Code task list on tool use events.
# Uses session_id when available; falls back to project-based task_list_id.

INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)
TASK_LIST="\${TODOS_CLAUDE_TASK_LIST:-\${SESSION_ID}}"

TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)

case "$TOOL_NAME" in
  TaskCreate|TaskUpdate)
    TODOS_CLAUDE_TASK_LIST="$TASK_LIST" ${todosBin} sync --all --pull 2>/dev/null || true
    ;;
  mcp__todos__*)
    TODOS_CLAUDE_TASK_LIST="$TASK_LIST" ${todosBin} sync --all --push 2>/dev/null || true
    ;;
esac

exit 0
`;
    const hookPath = join(hooksDir, "todos-sync.sh");
    writeFileSync(hookPath, hookScript);
    execSync(`chmod +x "${hookPath}"`);
    console.log(chalk.green(`Hook script created: ${hookPath}`));

    // Write/update .claude/settings.json with hook configuration
    // Uses the correct schema: PostToolUse > [{ matcher, hooks: [{ type, command }] }]
    const settingsPath = join(process.cwd(), ".claude", "settings.json");
    const settings = readJsonFile(settingsPath);

    if (!settings["hooks"]) {
      settings["hooks"] = {};
    }
    const hooksConfig = settings["hooks"] as Record<string, unknown>;

    if (!hooksConfig["PostToolUse"]) {
      hooksConfig["PostToolUse"] = [];
    }
    const postToolUse = hooksConfig["PostToolUse"] as Array<Record<string, unknown>>;

    // Remove existing todos-sync hooks
    const filtered = postToolUse.filter((group) => {
      const groupHooks = group["hooks"] as Array<Record<string, unknown>> | undefined;
      if (!groupHooks) return true;
      return !groupHooks.some((h) => (h["command"] as string || "").includes("todos-sync.sh"));
    });

    // Add our hook matcher groups
    filtered.push({
      matcher: "TaskCreate|TaskUpdate",
      hooks: [{ type: "command", command: hookPath }],
    });
    filtered.push({
      matcher: "mcp__todos__create_task|mcp__todos__update_task|mcp__todos__complete_task|mcp__todos__start_task",
      hooks: [{ type: "command", command: hookPath }],
    });

    hooksConfig["PostToolUse"] = filtered;
    writeJsonFile(settingsPath, settings);
    console.log(chalk.green(`Claude Code hooks configured in: ${settingsPath}`));
    console.log(chalk.dim("Task list ID auto-detected from project."));
  });

// mcp
program
  .command("mcp")
  .description("Start MCP server (stdio)")
  .option("--register <agent>", "Register MCP server with an agent (claude, codex, gemini, all)")
  .option("--unregister <agent>", "Unregister MCP server from an agent (claude, codex, gemini, all)")
  .option("-g, --global", "Register/unregister globally (user-level) instead of project-level")
  .action(async (opts) => {
    if (opts.register) {
      registerMcp(opts.register, opts.global);
      return;
    }
    if (opts.unregister) {
      unregisterMcp(opts.unregister, opts.global);
      return;
    }

    // Start MCP server by importing and running
    await import("../mcp/index.js");
  });

// --- MCP Registration Helpers ---

const HOME = process.env["HOME"] || process.env["USERPROFILE"] || "~";

function getMcpBinaryPath(): string {
  // Resolve the actual todos-mcp binary location
  try {
    const p = execSync("which todos-mcp", { encoding: "utf-8" }).trim();
    if (p) return p;
  } catch { /* fall through */ }

  // Fallback: check common bun global bin
  const bunBin = join(HOME, ".bun", "bin", "todos-mcp");
  if (existsSync(bunBin)) return bunBin;

  // Last resort: assume it's on PATH
  return "todos-mcp";
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function readTomlFile(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

function writeTomlFile(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content);
}

// --- Claude Code: .mcp.json at project root (mcpServers wrapper) ---

function registerClaude(binPath: string, global?: boolean): void {
  const configPath = global
    ? join(HOME, ".claude", ".mcp.json")
    : join(process.cwd(), ".mcp.json");
  const config = readJsonFile(configPath);

  if (!config["mcpServers"]) {
    config["mcpServers"] = {};
  }
  const servers = config["mcpServers"] as Record<string, unknown>;
  servers["todos"] = {
    command: binPath,
    args: [] as string[],
  };

  writeJsonFile(configPath, config);
  const scope = global ? "global" : "project";
  console.log(chalk.green(`Claude Code (${scope}): registered in ${configPath}`));
}

function unregisterClaude(global?: boolean): void {
  const configPath = global
    ? join(HOME, ".claude", ".mcp.json")
    : join(process.cwd(), ".mcp.json");
  const config = readJsonFile(configPath);
  const servers = config["mcpServers"] as Record<string, unknown> | undefined;

  if (!servers || !("todos" in servers)) {
    console.log(chalk.dim(`Claude Code: todos not found in ${configPath}`));
    return;
  }

  delete servers["todos"];
  writeJsonFile(configPath, config);
  const scope = global ? "global" : "project";
  console.log(chalk.green(`Claude Code (${scope}): unregistered from ${configPath}`));
}

// --- Codex CLI: ~/.codex/config.toml (TOML, [mcp_servers.todos]) ---

function registerCodex(binPath: string): void {
  const configPath = join(HOME, ".codex", "config.toml");
  let content = readTomlFile(configPath);

  // Remove existing [mcp_servers.todos] block if present
  content = removeTomlBlock(content, "mcp_servers.todos");

  // Append new block
  const block = `\n[mcp_servers.todos]\ncommand = "${binPath}"\nargs = []\n`;
  content = content.trimEnd() + "\n" + block;

  writeTomlFile(configPath, content);
  console.log(chalk.green(`Codex CLI: registered in ${configPath}`));
}

function unregisterCodex(): void {
  const configPath = join(HOME, ".codex", "config.toml");
  let content = readTomlFile(configPath);

  if (!content.includes("[mcp_servers.todos]")) {
    console.log(chalk.dim(`Codex CLI: todos not found in ${configPath}`));
    return;
  }

  content = removeTomlBlock(content, "mcp_servers.todos");
  writeTomlFile(configPath, content.trimEnd() + "\n");
  console.log(chalk.green(`Codex CLI: unregistered from ${configPath}`));
}

function removeTomlBlock(content: string, blockName: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let skipping = false;
  const header = `[${blockName}]`;

  for (const line of lines) {
    if (line.trim() === header) {
      skipping = true;
      continue;
    }
    // Stop skipping when we hit the next section header
    if (skipping && line.trim().startsWith("[")) {
      skipping = false;
    }
    if (!skipping) {
      result.push(line);
    }
  }

  return result.join("\n");
}

// --- Gemini CLI: ~/.gemini/settings.json (JSON, mcpServers wrapper) ---

function registerGemini(binPath: string): void {
  const configPath = join(HOME, ".gemini", "settings.json");
  const config = readJsonFile(configPath);

  if (!config["mcpServers"]) {
    config["mcpServers"] = {};
  }
  const servers = config["mcpServers"] as Record<string, unknown>;
  servers["todos"] = {
    command: binPath,
    args: [] as string[],
  };

  writeJsonFile(configPath, config);
  console.log(chalk.green(`Gemini CLI: registered in ${configPath}`));
}

function unregisterGemini(): void {
  const configPath = join(HOME, ".gemini", "settings.json");
  const config = readJsonFile(configPath);
  const servers = config["mcpServers"] as Record<string, unknown> | undefined;

  if (!servers || !("todos" in servers)) {
    console.log(chalk.dim(`Gemini CLI: todos not found in ${configPath}`));
    return;
  }

  delete servers["todos"];
  writeJsonFile(configPath, config);
  console.log(chalk.green(`Gemini CLI: unregistered from ${configPath}`));
}

// --- Main register/unregister ---

function registerMcp(agent: string, global?: boolean): void {
  const agents = agent === "all" ? ["claude", "codex", "gemini"] : [agent];
  const binPath = getMcpBinaryPath();

  for (const a of agents) {
    switch (a) {
      case "claude":
        registerClaude(binPath, global);
        break;
      case "codex":
        registerCodex(binPath);
        break;
      case "gemini":
        registerGemini(binPath);
        break;
      default:
        console.error(chalk.red(`Unknown agent: ${a}. Use: claude, codex, gemini, all`));
    }
  }
}

function unregisterMcp(agent: string, global?: boolean): void {
  const agents = agent === "all" ? ["claude", "codex", "gemini"] : [agent];

  for (const a of agents) {
    switch (a) {
      case "claude":
        unregisterClaude(global);
        break;
      case "codex":
        unregisterCodex();
        break;
      case "gemini":
        unregisterGemini();
        break;
      default:
        console.error(chalk.red(`Unknown agent: ${a}. Use: claude, codex, gemini, all`));
    }
  }
}

// init
program
  .command("init <name>")
  .description("Register an agent and get a short UUID")
  .option("-d, --description <text>", "Agent description")
  .action((name: string, opts) => {
    const globalOpts = program.opts();
    try {
      const agent = registerAgent({ name, description: opts.description });
      if (globalOpts.json) {
        output(agent, true);
      } else {
        console.log(chalk.green("Agent registered:"));
        console.log(`  ${chalk.dim("ID:")}   ${agent.id}`);
        console.log(`  ${chalk.dim("Name:")} ${agent.name}`);
        console.log(`\nUse ${chalk.cyan(`--agent ${agent.id}`)} on future commands.`);
      }
    } catch (e) {
      handleError(e);
    }
  });

// agents
program
  .command("agents")
  .description("List registered agents")
  .action(() => {
    const globalOpts = program.opts();
    try {
      const agents = listAgents();
      if (globalOpts.json) {
        output(agents, true);
        return;
      }
      if (agents.length === 0) {
        console.log(chalk.dim("No agents registered. Use 'todos init <name>' to register."));
        return;
      }
      for (const a of agents) {
        console.log(`  ${chalk.cyan(a.id)} ${chalk.bold(a.name)} ${chalk.dim(a.last_seen_at)}`);
      }
    } catch (e) {
      handleError(e);
    }
  });

// lists
program
  .command("lists")
  .aliases(["task-lists", "tl"])
  .description("List and manage task lists")
  .option("--add <name>", "Create a task list")
  .option("--slug <slug>", "Custom slug (with --add)")
  .option("-d, --description <text>", "Description (with --add)")
  .option("--delete <id>", "Delete a task list")
  .action((opts) => {
    try {
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);

      if (opts.add) {
        const list = createTaskList({ name: opts.add, slug: opts.slug, description: opts.description, project_id: projectId });
        if (globalOpts.json) {
          output(list, true);
          return;
        }
        console.log(chalk.green("Task list created:"));
        console.log(`  ${chalk.dim("ID:")}   ${list.id.slice(0, 8)}`);
        console.log(`  ${chalk.dim("Slug:")} ${list.slug}`);
        console.log(`  ${chalk.dim("Name:")} ${list.name}`);
        return;
      }

      if (opts.delete) {
        const db = getDatabase();
        const resolved = resolvePartialId(db, "task_lists", opts.delete);
        if (!resolved) {
          console.error(chalk.red("Task list not found"));
          process.exit(1);
        }
        deleteTaskList(resolved);
        console.log(chalk.green("Task list deleted."));
        return;
      }

      // Default: list task lists
      const lists = listTaskLists(projectId);
      if (globalOpts.json) {
        output(lists, true);
        return;
      }
      if (lists.length === 0) {
        console.log(chalk.dim("No task lists. Use 'todos lists --add <name>' to create one."));
        return;
      }
      for (const l of lists) {
        console.log(`  ${chalk.dim(l.id.slice(0, 8))} ${chalk.bold(l.name)} ${chalk.dim(`(${l.slug})`)}`);
      }
    } catch (e) {
      handleError(e);
    }
  });

// upgrade (self-update)
program
  .command("upgrade")
  .alias("self-update")
  .description("Update todos to the latest version")
  .option("--check", "Only check for updates, don't install")
  .action(async (opts) => {
    try {
      const currentVersion = getPackageVersion();

      const res = await fetch("https://registry.npmjs.org/@hasna/todos/latest");
      if (!res.ok) {
        console.error(chalk.red("Failed to check for updates."));
        process.exit(1);
      }
      const data = (await res.json()) as { version: string };
      const latestVersion = data.version;

      console.log(`  Current: ${chalk.dim(currentVersion)}`);
      console.log(`  Latest:  ${chalk.green(latestVersion)}`);

      if (currentVersion === latestVersion) {
        console.log(chalk.green("\nAlready up to date!"));
        return;
      }

      if (opts.check) {
        console.log(
          chalk.yellow(`\nUpdate available: ${currentVersion} → ${latestVersion}`),
        );
        return;
      }

      // Detect package manager
      let useBun = false;
      try {
        execSync("which bun", { stdio: "ignore" });
        useBun = true;
      } catch {
        // bun not available, fall back to npm
      }

      const cmd = useBun
        ? "bun add -g @hasna/todos@latest"
        : "npm install -g @hasna/todos@latest";

      console.log(chalk.dim(`\nRunning: ${cmd}`));
      execSync(cmd, { stdio: "inherit" });
      console.log(chalk.green(`\nUpdated to ${latestVersion}!`));
    } catch (e) {
      handleError(e);
    }
  });

// interactive (TUI)
program
  .command("interactive")
  .description("Launch interactive TUI")
  .action(async () => {
    const { renderApp } = await import("./components/App.js");
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);
    renderApp(projectId);
  });

// Default action: help or TUI
program.action(async () => {
  if (process.stdout.isTTY) {
    // Interactive terminal -> launch TUI
    try {
      const { renderApp } = await import("./components/App.js");
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);
      renderApp(projectId);
    } catch {
      program.help();
    }
  } else {
    program.help();
  }
});

program.parse();
