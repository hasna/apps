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
  getNextTask,
  claimNextTask,
  getStatus,
  failTask,
  getActiveWork,
  getStaleTasks,
  redistributeStaleTasks,
} from "../db/tasks.js";
import {
  createProject,
  listProjects,
  updateProject,
  ensureProject,
  getProjectByPath,
} from "../db/projects.js";
import { registerAgent, isAgentConflict, releaseAgent, listAgents } from "../db/agents.js";
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
import { getAgentTaskListId, loadConfig } from "../lib/config.js";
import type { Project, Task, TaskStatus, TaskPriority } from "../types/index.js";
import {
  createDispatch,
  listDispatches,
  cancelDispatch,
  getDueDispatches,
} from "../db/dispatches.js";
import { executeDispatch, runDueDispatches, dispatchToMultiple } from "../lib/dispatch.js";
import { formatDispatchMessage } from "../lib/dispatch-formatter.js";
import { calculateDelay } from "../lib/tmux.js";
import { getTaskList } from "../db/task-lists.js";

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
  const globalOpts = program.opts();
  if (globalOpts.json) {
    console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  } else {
    console.error(chalk.red(e instanceof Error ? e.message : String(e)));
  }
  process.exit(1);
}

function resolveTaskId(partialId: string): string {
  const db = getDatabase();
  const id = resolvePartialId(db, "tasks", partialId);
  if (!id) {
    // Try to find similar
    const similar = db.query("SELECT id FROM tasks WHERE id LIKE ? LIMIT 3").all(`%${partialId}%`) as { id: string }[];
    if (similar.length > 0) {
      console.error(chalk.red(`Could not resolve task ID: ${partialId}`));
      console.error(chalk.dim(`Did you mean: ${similar.map(s => s.id.slice(0, 8)).join(", ")}?`));
    } else {
      console.error(chalk.red(`Could not resolve task ID: ${partialId}`));
    }
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
  .option("-t, --tags <tags>", "Comma-separated tags")
  .option("--tag <tags>", "Comma-separated tags (alias for --tags)")
  .option("--plan <id>", "Assign to a plan")
  .option("--assign <agent>", "Assign to agent")
  .option("--status <status>", "Initial status")
  .option("--list <id>", "Task list ID")
  .option("--task-list <id>", "Task list ID (alias for --list)")
  .option("--estimated <minutes>", "Estimated time in minutes")
  .option("--approval", "Require approval before completion")
  .option("--recurrence <rule>", "Recurrence rule, e.g. 'every day', 'every weekday', 'every 2 weeks'")
  .option("--due <date>", "Due date (ISO string or YYYY-MM-DD)")
  .option("--reason <text>", "Why this task exists")
  .action((title: string, opts) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);
    opts.tags = opts.tags || opts.tag;
    opts.list = opts.list || opts.taskList;
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
      estimated_minutes: opts.estimated ? parseInt(opts.estimated, 10) : undefined,
      requires_approval: opts.approval || false,
      recurrence_rule: opts.recurrence,
      due_at: opts.due ? (opts.due.length === 10 ? opts.due + "T00:00:00.000Z" : opts.due) : undefined,
      reason: opts.reason,
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
  .option("--tag <tags>", "Filter by tags (alias for --tags)")
  .option("-a, --all", "Show all tasks (including completed/cancelled)")
  .option("--list <id>", "Filter by task list ID")
  .option("--task-list <id>", "Filter by task list ID (alias for --list)")
  .option("--project-name <name>", "Filter by project name")
  .option("--agent-name <name>", "Filter by agent name/assigned")
  .option("--sort <field>", "Sort by: updated, created, priority, status")
  .option("--format <fmt>", "Output format: table (default), compact, csv, json")
  .option("--due-today", "Only tasks due today or earlier")
  .option("--overdue", "Only overdue tasks (past due_at)")
  .option("--recurring", "Only recurring tasks")
  .option("--limit <n>", "Max tasks to return")
  .action((opts) => {
    const globalOpts = program.opts();
    opts.tags = opts.tags || opts.tag;
    opts.list = opts.list || opts.taskList;
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
    if (opts.projectName) {
      const projects = listProjects();
      const match = projects.find(p => p.name.toLowerCase().includes(opts.projectName.toLowerCase()));
      if (match) {
        filter["project_id"] = match.id;
      } else {
        console.error(chalk.red(`No project matching: ${opts.projectName}`));
        process.exit(1);
      }
    }
    if (opts.agentName) {
      filter["assigned_to"] = opts.agentName;
    }
    if (opts.recurring) filter["has_recurrence"] = true;
    if (opts.limit) filter["limit"] = parseInt(opts.limit, 10);

    let tasks = listTasks(filter as any);
    // Post-filter for due-today and overdue (not in TaskFilter directly)
    if (opts.dueToday) {
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      tasks = tasks.filter(t => t.due_at && t.due_at <= todayEnd.toISOString());
    }
    if (opts.overdue) {
      const now = new Date().toISOString();
      tasks = tasks.filter(t => t.due_at && t.due_at < now && t.status !== "completed");
    }
    if (opts.sort) {
      const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      tasks.sort((a: Task, b: Task) => {
        if (opts.sort === "updated") return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        if (opts.sort === "created") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (opts.sort === "priority") return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4);
        if (opts.sort === "status") return a.status.localeCompare(b.status);
        return 0;
      });
    }

    const fmt = opts.format || (globalOpts.json ? "json" : "table");

    if (fmt === "json") {
      output(tasks, true);
      return;
    }

    if (tasks.length === 0) {
      if (fmt === "compact" || fmt === "csv") process.stdout.write("");
      else console.log(chalk.dim("No tasks found."));
      return;
    }

    if (fmt === "csv") {
      const headers = "id,short_id,title,status,priority,assigned_to,updated_at";
      const rows = tasks.map((t: Task) => [
        t.id, t.short_id || "", t.title.replace(/,/g, ";"), t.status, t.priority, t.assigned_to || "", t.updated_at,
      ].join(","));
      console.log([headers, ...rows].join("\n"));
      return;
    }

    if (fmt === "compact") {
      // Ultra-minimal: one line per task, no labels, no color
      for (const t of tasks) {
        const id = t.short_id || t.id.slice(0, 8);
        const assigned = t.assigned_to ? ` ${t.assigned_to}` : "";
        process.stdout.write(`${id} ${t.status} ${t.priority} ${t.title}${assigned}\n`);
      }
      return;
    }

    // Default: human-readable table
    console.log(chalk.bold(`${tasks.length} task(s):\n`));
    for (const t of tasks) {
      console.log(formatTaskLine(t));
    }
  });

// count
program
  .command("count")
  .description("Show task count by status")
  .action(() => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);
    const all = listTasks({ project_id: projectId });
    const counts: Record<string, number> = { total: all.length };
    for (const t of all) counts[t.status] = (counts[t.status] || 0) + 1;

    if (globalOpts.json) {
      output(counts, true);
    } else {
      const parts = [
        `total: ${chalk.bold(String(counts.total))}`,
        `pending: ${chalk.yellow(String(counts["pending"] || 0))}`,
        `in_progress: ${chalk.blue(String(counts["in_progress"] || 0))}`,
        `completed: ${chalk.green(String(counts["completed"] || 0))}`,
        `failed: ${chalk.red(String(counts["failed"] || 0))}`,
        `cancelled: ${chalk.gray(String(counts["cancelled"] || 0))}`,
      ];
      console.log(parts.join("  "));
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
    if (task.requires_approval) {
      const approvalStatus = task.approved_by ? chalk.green(`approved by ${task.approved_by}`) : chalk.yellow("pending approval");
      console.log(`  ${chalk.dim("Approval:")} ${approvalStatus}`);
    }
    if (task.estimated_minutes) console.log(`  ${chalk.dim("Estimate:")} ${task.estimated_minutes} minutes`);
    if (task.project_id) console.log(`  ${chalk.dim("Project:")}  ${task.project_id}`);
    if (task.plan_id) console.log(`  ${chalk.dim("Plan:")}     ${task.plan_id}`);
    if (task.working_dir) console.log(`  ${chalk.dim("WorkDir:")}  ${task.working_dir}`);
    if (task.parent) console.log(`  ${chalk.dim("Parent:")}   ${task.parent.id.slice(0, 8)} | ${task.parent.title}`);
    if (task.tags.length > 0) console.log(`  ${chalk.dim("Tags:")}     ${task.tags.join(", ")}`);
    console.log(`  ${chalk.dim("Version:")}  ${task.version}`);
    console.log(`  ${chalk.dim("Created:")}  ${task.created_at}`);
    if (task.started_at) console.log(`  ${chalk.dim("Started:")}  ${task.started_at}`);
    if (task.completed_at) {
      console.log(`  ${chalk.dim("Done:")}     ${task.completed_at}`);
      if (task.started_at) {
        const dur = Math.round((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 60000);
        console.log(`  ${chalk.dim("Duration:")} ${dur}m`);
      }
    }

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

// inspect — deep task orientation (different from session "context")
program
  .command("inspect [id]")
  .description("Full orientation for a task — details, description, dependencies, blockers, files, commits, comments. If no ID given, shows current in-progress task for --agent.")
  .action((id?: string) => {
    const globalOpts = program.opts();
    let resolvedId = id ? resolveTaskId(id) : null;

    // If no ID, find agent's active task
    if (!resolvedId && globalOpts.agent) {
      const { listTasks } = require("../db/tasks.js") as any;
      const active = listTasks({ status: "in_progress", assigned_to: globalOpts.agent });
      if (active.length > 0) resolvedId = active[0].id;
    }
    if (!resolvedId) { console.error(chalk.red("No task ID given and no active task found. Pass an ID or use --agent.")); process.exit(1); }

    const task = getTaskWithRelations(resolvedId);
    if (!task) { console.error(chalk.red(`Task not found: ${id || resolvedId}`)); process.exit(1); }

    if (globalOpts.json) {
      // Enrich with files and commits
      const { listTaskFiles } = require("../db/task-files.js") as any;
      const { getTaskCommits } = require("../db/task-commits.js") as any;
      try { (task as any).files = listTaskFiles(task.id); } catch { (task as any).files = []; }
      try { (task as any).commits = getTaskCommits(task.id); } catch { (task as any).commits = []; }
      output(task, true);
      return;
    }

    // Header
    const sid = task.short_id || task.id.slice(0, 8);
    const statusColor = statusColors[task.status] || chalk.white;
    const prioColor = priorityColors[task.priority] || chalk.white;
    console.log(chalk.bold(`\n${chalk.cyan(sid)} ${statusColor(task.status)} ${prioColor(task.priority)} ${task.title}\n`));

    // Description
    if (task.description) {
      console.log(chalk.dim("Description:"));
      console.log(`  ${task.description}\n`);
    }

    // Key fields
    if (task.assigned_to) console.log(`  ${chalk.dim("Assigned:")}  ${task.assigned_to}`);
    if (task.locked_by) console.log(`  ${chalk.dim("Locked by:")} ${task.locked_by}`);
    if (task.project_id) console.log(`  ${chalk.dim("Project:")}   ${task.project_id}`);
    if (task.plan_id) console.log(`  ${chalk.dim("Plan:")}      ${task.plan_id}`);
    if (task.started_at) console.log(`  ${chalk.dim("Started:")}   ${task.started_at}`);
    if (task.completed_at) {
      console.log(`  ${chalk.dim("Completed:")} ${task.completed_at}`);
      if (task.started_at) {
        const dur = Math.round((new Date(task.completed_at).getTime() - new Date(task.started_at).getTime()) / 60000);
        console.log(`  ${chalk.dim("Duration:")}  ${dur}m`);
      }
    }
    if (task.estimated_minutes) console.log(`  ${chalk.dim("Estimate:")}  ${task.estimated_minutes}m`);
    if (task.tags.length > 0) console.log(`  ${chalk.dim("Tags:")}      ${task.tags.join(", ")}`);

    // Dependencies
    const unfinishedDeps = task.dependencies.filter(d => d.status !== "completed" && d.status !== "cancelled");
    if (task.dependencies.length > 0) {
      console.log(chalk.bold(`\n  Depends on (${task.dependencies.length}):`));
      for (const dep of task.dependencies) {
        const blocked = dep.status !== "completed" && dep.status !== "cancelled";
        const icon = blocked ? chalk.red("✗") : chalk.green("✓");
        console.log(`    ${icon} ${formatTaskLine(dep)}`);
      }
    }
    if (unfinishedDeps.length > 0) {
      console.log(chalk.red(`\n  BLOCKED by ${unfinishedDeps.length} unfinished dep(s)`));
    }

    // Blocks
    if (task.blocked_by.length > 0) {
      console.log(chalk.bold(`\n  Blocks (${task.blocked_by.length}):`));
      for (const b of task.blocked_by) console.log(`    ${formatTaskLine(b)}`);
    }

    // Subtasks
    if (task.subtasks.length > 0) {
      console.log(chalk.bold(`\n  Subtasks (${task.subtasks.length}):`));
      for (const st of task.subtasks) console.log(`    ${formatTaskLine(st)}`);
    }

    // Files
    try {
      const { listTaskFiles } = require("../db/task-files.js") as any;
      const files = listTaskFiles(task.id);
      if (files.length > 0) {
        console.log(chalk.bold(`\n  Files (${files.length}):`));
        for (const f of files) console.log(`    ${chalk.dim(f.role || "file")} ${f.path}`);
      }
    } catch {}

    // Commits
    try {
      const { getTaskCommits } = require("../db/task-commits.js") as any;
      const commits = getTaskCommits(task.id);
      if (commits.length > 0) {
        console.log(chalk.bold(`\n  Commits (${commits.length}):`));
        for (const c of commits) console.log(`    ${chalk.yellow(c.commit_hash.slice(0, 7))} ${c.message || ""}`);
      }
    } catch {}

    // Comments
    if (task.comments.length > 0) {
      console.log(chalk.bold(`\n  Comments (${task.comments.length}):`));
      for (const c of task.comments) {
        const agent = c.agent_id ? chalk.cyan(`[${c.agent_id}] `) : "";
        console.log(`    ${agent}${chalk.dim(c.created_at)}: ${c.content}`);
      }
    }

    // Checklist
    if (task.checklist && task.checklist.length > 0) {
      const done = task.checklist.filter((c: any) => c.checked).length;
      console.log(chalk.bold(`\n  Checklist (${done}/${task.checklist.length}):`));
      for (const item of task.checklist) {
        const icon = (item as any).checked ? chalk.green("☑") : chalk.dim("☐");
        console.log(`    ${icon} ${(item as any).text || (item as any).title}`);
      }
    }

    console.log();
  });

// history
program
  .command("history <id>")
  .description("Show change history for a task (audit log)")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const { getTaskHistory } = require("../db/audit.js");
    const history = getTaskHistory(resolvedId);

    if (globalOpts.json) {
      output(history, true);
      return;
    }

    if (history.length === 0) {
      console.log(chalk.dim("No history for this task."));
      return;
    }

    console.log(chalk.bold(`${history.length} change(s):\n`));
    for (const h of history) {
      const agent = h.agent_id ? chalk.cyan(` by ${h.agent_id}`) : "";
      const field = h.field ? chalk.yellow(` ${h.field}`) : "";
      const change = h.old_value && h.new_value ? ` ${chalk.red(h.old_value)} → ${chalk.green(h.new_value)}` : h.new_value ? ` → ${chalk.green(h.new_value)}` : "";
      console.log(`  ${chalk.dim(h.created_at)} ${chalk.bold(h.action)}${field}${change}${agent}`);
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
  .option("--tag <tags>", "New tags (alias for --tags)")
  .option("--list <id>", "Move to a task list")
  .option("--task-list <id>", "Move to a task list (alias for --list)")
  .option("--estimated <minutes>", "Estimated time in minutes")
  .option("--approval", "Require approval before completion")
  .action((id: string, opts) => {
    const globalOpts = program.opts();
    opts.tags = opts.tags || opts.tag;
    opts.list = opts.list || opts.taskList;
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
        estimated_minutes: opts.estimated !== undefined ? parseInt(opts.estimated, 10) : undefined,
        requires_approval: opts.approval !== undefined ? true : undefined,
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
  .option("--attach-ids <ids>", "Comma-separated @hasna/attachments IDs to link as evidence")
  .option("--files-changed <files>", "Comma-separated list of files changed")
  .option("--test-results <results>", "Test results summary")
  .option("--commit-hash <hash>", "Git commit hash")
  .option("--notes <notes>", "Completion notes")
  .option("--confidence <0-1>", "Agent's confidence 0.0-1.0 that the task is fully complete (default: 1.0, <0.7 flagged for review)")
  .action((id: string, opts: { attachIds?: string; filesChanged?: string; testResults?: string; commitHash?: string; notes?: string; confidence?: string }) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const attachmentIds = opts.attachIds ? opts.attachIds.split(",").map((s) => s.trim()) : undefined;
    const filesChanged = opts.filesChanged ? opts.filesChanged.split(",").map((s) => s.trim()) : undefined;
    const confidence = opts.confidence !== undefined ? parseFloat(opts.confidence) : undefined;
    const evidence = (attachmentIds || filesChanged || opts.testResults || opts.commitHash || opts.notes)
      ? { attachment_ids: attachmentIds, files_changed: filesChanged, test_results: opts.testResults, commit_hash: opts.commitHash, notes: opts.notes }
      : undefined;
    let task;
    try {
      task = completeTask(resolvedId, globalOpts.agent, undefined, { ...evidence, confidence });
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

// approve
program
  .command("approve <id>")
  .description("Approve a task that requires approval")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const task = getTask(resolvedId);
    if (!task) { console.error(chalk.red(`Task not found: ${id}`)); process.exit(1); }

    if (!task.requires_approval) {
      console.log(chalk.yellow("This task does not require approval."));
      return;
    }
    if (task.approved_by) {
      console.log(chalk.yellow(`Already approved by ${task.approved_by}.`));
      return;
    }

    try {
      const updated = updateTask(resolvedId, { approved_by: globalOpts.agent || "cli", version: task.version });
      if (globalOpts.json) {
        output(updated, true);
      } else {
        console.log(chalk.green(`Task approved by ${globalOpts.agent || "cli"}:`));
        console.log(formatTaskLine(updated));
      }
    } catch (e) {
      handleError(e);
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

// remove — alias for delete (consistent with open-* CLI conventions)
program
  .command("remove <id>")
  .description("Remove/delete a task (alias for delete)")
  .action((id: string) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const deleted = deleteTask(resolvedId);
    if (globalOpts.json) {
      output({ deleted }, true);
    } else if (deleted) {
      console.log(chalk.green("Task removed."));
    } else {
      console.error(chalk.red("Task not found."));
      process.exit(1);
    }
  });

// bulk
program
  .command("bulk <action> <ids...>")
  .description("Bulk operation on multiple tasks (done, start, delete)")
  .action((action: string, ids: string[]) => {
    const globalOpts = program.opts();
    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const rawId of ids) {
      try {
        const resolvedId = resolveTaskId(rawId);
        if (action === "done" || action === "complete") {
          completeTask(resolvedId, globalOpts.agent);
          results.push({ id: resolvedId, success: true });
        } else if (action === "start") {
          startTask(resolvedId, globalOpts.agent || "cli");
          results.push({ id: resolvedId, success: true });
        } else if (action === "delete") {
          deleteTask(resolvedId);
          results.push({ id: resolvedId, success: true });
        } else {
          console.error(chalk.red(`Unknown action: ${action}. Use: done, start, delete`));
          process.exit(1);
        }
      } catch (e) {
        results.push({ id: rawId, success: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    if (globalOpts.json) {
      output({ results, succeeded, failed }, true);
    } else {
      console.log(chalk.green(`${action}: ${succeeded} succeeded, ${failed} failed`));
      for (const r of results.filter(r => !r.success)) {
        console.log(chalk.red(`  ${r.id}: ${r.error}`));
      }
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

// templates
program
  .command("templates")
  .description("List and manage task templates")
  .option("--add <name>", "Create a template")
  .option("--title <pattern>", "Title pattern (with --add)")
  .option("-d, --description <text>", "Default description")
  .option("-p, --priority <level>", "Default priority")
  .option("-t, --tags <tags>", "Default tags (comma-separated)")
  .option("--delete <id>", "Delete a template")
  .option("--update <id>", "Update a template")
  .option("--use <id>", "Create a task from a template")
  .action((opts) => {
    const globalOpts = program.opts();
    const { createTemplate, listTemplates, deleteTemplate, updateTemplate, taskFromTemplate } = require("../db/templates.js");

    if (opts.add) {
      if (!opts.title) { console.error(chalk.red("--title is required with --add")); process.exit(1); }
      const projectId = autoProject(globalOpts);
      const template = createTemplate({
        name: opts.add,
        title_pattern: opts.title,
        description: opts.description,
        priority: opts.priority || "medium",
        tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : [],
        project_id: projectId,
      });
      if (globalOpts.json) { output(template, true); }
      else { console.log(chalk.green(`Template created: ${template.id.slice(0, 8)} | ${template.name} | "${template.title_pattern}"`)); }
      return;
    }

    if (opts.delete) {
      const deleted = deleteTemplate(opts.delete);
      if (globalOpts.json) { output({ deleted }, true); }
      else if (deleted) { console.log(chalk.green("Template deleted.")); }
      else { console.error(chalk.red("Template not found.")); process.exit(1); }
      return;
    }

    if (opts.update) {
      const updates: Record<string, any> = {};
      if (opts.add) updates.name = opts.add;
      if (opts.title) updates.title_pattern = opts.title;
      if (opts.description) updates.description = opts.description;
      if (opts.priority) updates.priority = opts.priority;
      if (opts.tags) updates.tags = opts.tags.split(",").map((t: string) => t.trim());
      const updated = updateTemplate(opts.update, updates);
      if (!updated) { console.error(chalk.red("Template not found.")); process.exit(1); }
      if (globalOpts.json) { output(updated, true); }
      else { console.log(chalk.green(`Template updated: ${updated.id.slice(0, 8)} | ${updated.name} | "${updated.title_pattern}"`)); }
      return;
    }

    if (opts.use) {
      try {
        const input = taskFromTemplate(opts.use, {
          title: opts.title,
          description: opts.description,
          priority: opts.priority,
        });
        const task = createTask({ ...input, project_id: input.project_id || autoProject(globalOpts) });
        if (globalOpts.json) { output(task, true); }
        else { console.log(chalk.green("Task created from template:")); console.log(formatTaskLine(task)); }
      } catch (e) { handleError(e); }
      return;
    }

    // List templates
    const templates = listTemplates();
    if (globalOpts.json) { output(templates, true); return; }
    if (templates.length === 0) { console.log(chalk.dim("No templates.")); return; }
    console.log(chalk.bold(`${templates.length} template(s):\n`));
    for (const t of templates) {
      const vars = t.variables && t.variables.length > 0 ? ` ${chalk.dim(`(${t.variables.map((v: any) => `${v.name}${v.required ? '*' : ''}${v.default ? `=${v.default}` : ''}`).join(', ')})`)}` : "";
      console.log(`  ${chalk.dim(t.id.slice(0, 8))} ${chalk.bold(t.name)} ${chalk.cyan(`"${t.title_pattern}"`)} ${chalk.yellow(t.priority)}${vars}`);
    }
  });

// template init — initialize built-in starter templates
program
  .command("template-init")
  .alias("templates-init")
  .description("Initialize built-in starter templates (open-source-project, bug-fix, feature, security-audit)")
  .action(() => {
    const globalOpts = program.opts();
    const { initBuiltinTemplates } = require("../db/builtin-templates.js");
    const result = initBuiltinTemplates();
    if (globalOpts.json) { output(result, true); return; }
    if (result.created === 0) {
      console.log(chalk.dim(`All ${result.skipped} built-in template(s) already exist.`));
    } else {
      console.log(chalk.green(`Created ${result.created} template(s): ${result.names.join(", ")}. Skipped ${result.skipped} existing.`));
    }
  });

// template preview — preview template without creating tasks
program
  .command("template-preview <id>")
  .alias("templates-preview")
  .description("Preview a template without creating tasks — shows resolved titles, deps, and priorities")
  .option("--var <vars...>", "Variable substitution in key=value format (e.g. --var name=invoices)")
  .action((id: string, opts: { var?: string[] }) => {
    const globalOpts = program.opts();
    const { previewTemplate } = require("../db/templates.js");

    // Parse --var key=value pairs
    const variables: Record<string, string> = {};
    if (opts.var) {
      for (const v of opts.var) {
        const eq = v.indexOf("=");
        if (eq === -1) { console.error(chalk.red(`Invalid variable format: ${v} (expected key=value)`)); process.exit(1); }
        variables[v.slice(0, eq)] = v.slice(eq + 1);
      }
    }

    try {
      const preview = previewTemplate(id, Object.keys(variables).length > 0 ? variables : undefined);
      if (globalOpts.json) { output(preview, true); return; }

      console.log(chalk.bold(`Preview: ${preview.template_name} (${preview.tasks.length} tasks)`));
      if (preview.description) console.log(chalk.dim(`  ${preview.description}`));
      if (preview.variables.length > 0) {
        console.log(chalk.dim(`  Variables: ${preview.variables.map((v: any) => `${v.name}${v.required ? '*' : ''}${v.default ? `=${v.default}` : ''}`).join(', ')}`));
      }
      if (Object.keys(preview.resolved_variables).length > 0) {
        console.log(chalk.dim(`  Resolved: ${Object.entries(preview.resolved_variables).map(([k, v]) => `${k}=${v}`).join(', ')}`));
      }
      console.log();
      for (const t of preview.tasks) {
        const deps = t.depends_on_positions.length > 0 ? chalk.dim(` (after: ${t.depends_on_positions.join(", ")})`) : "";
        console.log(`  ${chalk.dim(`[${t.position}]`)} ${chalk.yellow(t.priority)} | ${t.title}${deps}`);
      }
    } catch (e) { handleError(e); }
  });

// template export — export a template as JSON
program
  .command("template-export <id>")
  .alias("templates-export")
  .description("Export a template as JSON to stdout")
  .action((id: string) => {
    const { exportTemplate } = require("../db/templates.js");
    try {
      const json = exportTemplate(id);
      console.log(JSON.stringify(json, null, 2));
    } catch (e) { handleError(e); }
  });

// template import — import a template from JSON
program
  .command("template-import")
  .alias("templates-import")
  .description("Import a template from a JSON file")
  .option("--file <path>", "Path to template JSON file")
  .action((opts: { file?: string }) => {
    const globalOpts = program.opts();
    const { importTemplate } = require("../db/templates.js");
    const { readFileSync } = require("fs");
    try {
      if (!opts.file) { console.error(chalk.red("--file is required")); process.exit(1); }
      const content = readFileSync(opts.file, "utf-8");
      const json = JSON.parse(content);
      const template = importTemplate(json);
      if (globalOpts.json) { output(template, true); }
      else { console.log(chalk.green(`Template imported: ${template.id.slice(0, 8)} | ${template.name} | "${template.title_pattern}"`)); }
    } catch (e) { handleError(e); }
  });

// template history — show version history of a template
program
  .command("template-history <id>")
  .alias("templates-history")
  .description("Show version history of a template")
  .action((id: string) => {
    const globalOpts = program.opts();
    const { listTemplateVersions, getTemplate } = require("../db/templates.js");
    try {
      const template = getTemplate(id);
      if (!template) { console.error(chalk.red("Template not found.")); process.exit(1); }
      const versions = listTemplateVersions(id);
      if (globalOpts.json) { output({ current_version: template.version, versions }, true); return; }
      console.log(chalk.bold(`${template.name} — current version: ${template.version}`));
      if (versions.length === 0) {
        console.log(chalk.dim("  No previous versions."));
      } else {
        for (const v of versions) {
          const snap = JSON.parse(v.snapshot);
          console.log(`  ${chalk.dim(`v${v.version}`)} | ${v.created_at} | ${snap.name} | "${snap.title_pattern}"`);
        }
      }
    } catch (e) { handleError(e); }
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
    if (opts.status) searchOpts.status = opts.status;
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
  .action((scanPath: string, opts) => {
    try {
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts);
      const { extractTodos, EXTRACT_TAGS } = require("../lib/extract.js") as typeof import("../lib/extract.js");
      const patterns = opts.pattern
        ? opts.pattern.split(",").map((t: string) => t.trim().toUpperCase()) as typeof EXTRACT_TAGS[number][]
        : undefined;
      const taskListId = opts.list ? (() => {
        const db = getDatabase();
        const id = resolvePartialId(db, "task_lists", opts.list);
        if (!id) {
          console.error(chalk.red(`Could not resolve task list ID: ${opts.list}`));
          process.exit(1);
        }
        return id;
      })() : undefined;
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

// --- Claude Code: use `claude mcp add` (correct approach, not .mcp.json) ---

function registerClaude(binPath: string, global?: boolean): void {
  const scope = global ? "user" : "project";
  const cmd = `claude mcp add --transport stdio --scope ${scope} todos -- ${binPath}`;
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    execSync(cmd, { stdio: "pipe" });
    console.log(chalk.green(`Claude Code (${scope}): registered via 'claude mcp add'`));
  } catch {
    // claude CLI not found — print the command for the user to run manually
    console.log(chalk.yellow(`Claude Code: could not auto-register. Run this command manually:`));
    console.log(chalk.cyan(`  ${cmd}`));
  }
}

function unregisterClaude(_global?: boolean): void {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    execSync("claude mcp remove todos", { stdio: "pipe" });
    console.log(chalk.green(`Claude Code: removed todos MCP server`));
  } catch {
    console.log(chalk.yellow(`Claude Code: could not auto-remove. Run manually:`));
    console.log(chalk.cyan("  claude mcp remove todos"));
  }
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

// import — GitHub issue import
program
  .command("import <url>")
  .description("Import a GitHub issue as a task")
  .option("--project <id>", "Project ID")
  .option("--list <id>", "Task list ID")
  .action((url: string, opts: { project?: string; list?: string }) => {
    const globalOpts = program.opts();
    const { parseGitHubUrl, fetchGitHubIssue, issueToTask } = require("../lib/github.js") as any;
    const parsed = parseGitHubUrl(url);
    if (!parsed) { console.error(chalk.red("Invalid GitHub issue URL. Expected: https://github.com/owner/repo/issues/123")); process.exit(1); }
    try {
      const issue = fetchGitHubIssue(parsed.owner, parsed.repo, parsed.number);
      const projectId = opts.project || autoProject(globalOpts) || undefined;
      const input = issueToTask(issue, { project_id: projectId, task_list_id: opts.list });
      const task = createTask(input);
      if (globalOpts.json) { output(task, true); return; }
      console.log(chalk.green(`Imported GH#${issue.number}: ${issue.title}`));
      console.log(`  ${chalk.dim("Task ID:")} ${task.short_id || task.id}`);
      console.log(`  ${chalk.dim("Labels:")}  ${issue.labels.join(", ") || "none"}`);
      console.log(`  ${chalk.dim("Priority:")} ${task.priority}`);
    } catch (e: any) {
      if (e.message?.includes("gh")) {
        console.error(chalk.red("GitHub CLI (gh) not found or not authenticated. Install: https://cli.github.com"));
      } else {
        console.error(chalk.red(`Import failed: ${e.message}`));
      }
      process.exit(1);
    }
  });

// link-commit — manual or hook-driven commit linking
program
  .command("link-commit <task-id> <sha>")
  .description("Link a git commit to a task")
  .option("--message <text>", "Commit message")
  .option("--author <name>", "Commit author")
  .option("--files <list>", "Comma-separated list of changed files")
  .action((taskId: string, sha: string, opts: { message?: string; author?: string; files?: string }) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(taskId);
    const { linkTaskToCommit } = require("../db/task-commits.js") as any;
    const commit = linkTaskToCommit({
      task_id: resolvedId,
      sha,
      message: opts.message,
      author: opts.author,
      files_changed: opts.files ? opts.files.split(",").filter(Boolean) : undefined,
    });
    if (globalOpts.json) { output(commit, true); return; }
    console.log(chalk.green(`Linked commit ${sha.slice(0, 7)} to task ${taskId}`));
  });

// hook install/uninstall
const hookCmd = program.command("hook").description("Manage git hooks for auto-linking commits to tasks");
hookCmd
  .command("install")
  .description("Install post-commit hook that auto-links commits to tasks")
  .action(() => {
    const { execSync } = require("child_process");
    try {
      const gitDir = execSync("git rev-parse --git-dir", { encoding: "utf-8" }).trim();
      const hookPath = `${gitDir}/hooks/post-commit`;
      const { existsSync, readFileSync, writeFileSync, chmodSync } = require("fs");
      const marker = "# todos-auto-link";

      if (existsSync(hookPath)) {
        const existing = readFileSync(hookPath, "utf-8");
        if (existing.includes(marker)) {
          console.log(chalk.yellow("Hook already installed."));
          return;
        }
        // Append to existing hook
        writeFileSync(hookPath, existing + `\n${marker}\n$(dirname "$0")/../../scripts/post-commit-hook.sh\n`);
      } else {
        writeFileSync(hookPath, `#!/usr/bin/env bash\n${marker}\n$(dirname "$0")/../../scripts/post-commit-hook.sh\n`);
        chmodSync(hookPath, 0o755);
      }
      console.log(chalk.green("Post-commit hook installed. Commits with task IDs (e.g. OPE-00042) will auto-link."));
    } catch (e) {
      console.error(chalk.red("Not in a git repository or hook install failed."));
      process.exit(1);
    }
  });

hookCmd
  .command("uninstall")
  .description("Remove the todos post-commit hook")
  .action(() => {
    const { execSync } = require("child_process");
    try {
      const gitDir = execSync("git rev-parse --git-dir", { encoding: "utf-8" }).trim();
      const hookPath = `${gitDir}/hooks/post-commit`;
      const { existsSync, readFileSync, writeFileSync } = require("fs");
      const marker = "# todos-auto-link";

      if (!existsSync(hookPath)) {
        console.log(chalk.dim("No post-commit hook found."));
        return;
      }
      const content = readFileSync(hookPath, "utf-8");
      if (!content.includes(marker)) {
        console.log(chalk.dim("Hook not managed by todos."));
        return;
      }
      // Remove our lines
      const cleaned = content.split("\n").filter((l: string) => !l.includes(marker) && !l.includes("post-commit-hook.sh")).join("\n").trim();
      if (cleaned === "#!/usr/bin/env bash" || cleaned === "") {
        require("fs").unlinkSync(hookPath);
      } else {
        writeFileSync(hookPath, cleaned + "\n");
      }
      console.log(chalk.green("Post-commit hook removed."));
    } catch (e) {
      console.error(chalk.red("Not in a git repository or hook removal failed."));
      process.exit(1);
    }
  });

// init
program
  .command("init <name>")
  .description("Register an agent and get a short UUID")
  .option("-d, --description <text>", "Agent description")
  .action((name: string, opts) => {
    const globalOpts = program.opts();
    try {
      const result = registerAgent({ name, description: opts.description });
      if (isAgentConflict(result)) {
        console.error(chalk.red("CONFLICT:"), result.message);
        process.exit(1);
      }
      if (globalOpts.json) {
        output(result, true);
      } else {
        console.log(chalk.green("Agent registered:"));
        console.log(`  ${chalk.dim("ID:")}   ${result.id}`);
        console.log(`  ${chalk.dim("Name:")} ${result.name}`);
        console.log(`\nUse ${chalk.cyan(`--agent ${result.id}`)} on future commands.`);
      }
    } catch (e) {
      handleError(e);
    }
  });

// heartbeat
program
  .command("heartbeat [agent]")
  .description("Update last_seen_at to signal you're still active")
  .action((agent?: string) => {
    const globalOpts = program.opts();
    const agentId = agent || globalOpts.agent;
    if (!agentId) { console.error(chalk.red("Agent ID required. Use --agent or pass as argument.")); process.exit(1); }
    const { updateAgentActivity, getAgent } = require("../db/agents.js") as any;
    const a = getAgent(agentId) || require("../db/agents.js").getAgentByName(agentId);
    if (!a) { console.error(chalk.red(`Agent not found: ${agentId}`)); process.exit(1); }
    updateAgentActivity(a.id);
    if (globalOpts.json) { console.log(JSON.stringify({ agent_id: a.id, name: a.name, last_seen_at: new Date().toISOString() })); }
    else { console.log(chalk.green(`♥ ${a.name} (${a.id.slice(0, 8)}) — heartbeat sent`)); }
  });

// release
program
  .command("release [agent]")
  .description("Release/logout an agent — clears session binding so the name is immediately available")
  .option("--session-id <id>", "Only release if session ID matches")
  .action((agent?: string, opts?: { sessionId?: string }) => {
    const globalOpts = program.opts();
    const agentId = agent || globalOpts.agent;
    if (!agentId) { console.error(chalk.red("Agent ID or name required. Use --agent or pass as argument.")); process.exit(1); }
    const { getAgent, getAgentByName } = require("../db/agents.js") as any;
    const a = getAgent(agentId) || getAgentByName(agentId);
    if (!a) { console.error(chalk.red(`Agent not found: ${agentId}`)); process.exit(1); }
    const released = releaseAgent(a.id, opts?.sessionId);
    if (!released) {
      console.error(chalk.red("Release denied: session_id does not match agent's current session."));
      process.exit(1);
    }
    if (globalOpts.json) {
      console.log(JSON.stringify({ agent_id: a.id, name: a.name, released: true }));
    } else {
      console.log(chalk.green(`✓ ${a.name} (${a.id}) released — name is now available.`));
    }
  });

// focus
program
  .command("focus [project]")
  .description("Focus on a project (or clear focus if no project given)")
  .action((project?: string) => {
    const globalOpts = program.opts();
    const agentId = globalOpts.agent;
    if (!agentId) { console.error(chalk.red("Agent ID required. Use --agent.")); process.exit(1); }
    const db = getDatabase();
    if (project) {
      const { getProjectByPath, getProjectByName } = require("../db/projects.js") as any;
      const p = getProjectByPath(process.cwd(), db) || getProjectByName(project, db);
      const projectId = p?.id || project;
      db.run("UPDATE agents SET active_project_id = ? WHERE id = ? OR name = ?", [projectId, agentId, agentId]);
      console.log(chalk.green(`Focused on: ${p?.name || projectId}`));
    } else {
      db.run("UPDATE agents SET active_project_id = NULL WHERE id = ? OR name = ?", [agentId, agentId]);
      console.log(chalk.dim("Focus cleared."));
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

// agent-update <name>
program
  .command("agent-update <name>")
  .alias("agents-update")
  .description("Update an agent's description, role, or other fields")
  .option("--description <text>", "New description")
  .option("--role <role>", "New role")
  .option("--title <title>", "New title")
  .action((name: string, opts) => {
    const globalOpts = program.opts();
    try {
      const { getAgentByName: findByName, updateAgent: doUpdate } = require("../db/agents.js") as any;
      const agent = findByName(name);
      if (!agent) {
        console.error(chalk.red(`Agent not found: ${name}`));
        process.exit(1);
      }
      const updates: Record<string, unknown> = {};
      if (opts.description !== undefined) updates.description = opts.description;
      if (opts.role !== undefined) updates.role = opts.role;
      if (opts.title !== undefined) updates.title = opts.title;
      const updated = doUpdate(agent.id, updates);
      if (globalOpts.json) {
        output(updated, true);
      } else {
        console.log(chalk.green(`Updated agent: ${updated.name} (${updated.id.slice(0, 8)})`));
        if (updated.description) console.log(chalk.dim(`  Description: ${updated.description}`));
        if (updated.role) console.log(chalk.dim(`  Role: ${updated.role}`));
      }
    } catch (e) {
      handleError(e);
    }
  });

// agent <name> — rich single-agent view
program
  .command("agent <name>")
  .description("Show all info about an agent: tasks, status, last seen, stats")
  .option("--json", "Output as JSON")
  .action((name: string, opts) => {
    const globalOpts = program.opts();
    // Find agent by name or partial ID
    const { getAgentByName: findByName } = require("../db/agents.js") as any;
    const agent = findByName(name);

    if (!agent) {
      console.error(chalk.red(`Agent not found: ${name}`));
      process.exit(1);
    }

    // Get their tasks
    const byAssigned = listTasks({ assigned_to: agent.name });
    const byId = listTasks({ agent_id: agent.id });
    const seen = new Set<string>();
    const allTasks = [...byAssigned, ...byId].filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id); return true;
    });

    const pending = allTasks.filter(t => t.status === "pending");
    const inProgress = allTasks.filter(t => t.status === "in_progress");
    const completed = allTasks.filter(t => t.status === "completed");
    const failed = allTasks.filter(t => t.status === "failed");
    const rate = allTasks.length > 0 ? Math.round((completed.length / allTasks.length) * 100) : 0;

    // Last seen — how long ago
    const lastSeenMs = Date.now() - new Date(agent.last_seen_at).getTime();
    const lastSeenMins = Math.floor(lastSeenMs / 60000);
    const lastSeenStr = lastSeenMins < 2 ? chalk.green("just now")
      : lastSeenMins < 60 ? chalk.yellow(`${lastSeenMins}m ago`)
      : lastSeenMins < 1440 ? chalk.yellow(`${Math.floor(lastSeenMins / 60)}h ago`)
      : chalk.dim(`${Math.floor(lastSeenMins / 1440)}d ago`);

    const isOnline = lastSeenMins < 5;

    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify({ agent, tasks: { pending: pending.length, in_progress: inProgress.length, completed: completed.length, failed: failed.length, total: allTasks.length, completion_rate: rate }, all_tasks: allTasks }, null, 2));
      return;
    }

    // Header
    console.log(`\n${isOnline ? chalk.green("●") : chalk.dim("○")} ${chalk.bold(agent.name)} ${chalk.dim(`(${agent.id})`)}  ${lastSeenStr}`);
    if (agent.description) console.log(chalk.dim(`  ${agent.description}`));
    if (agent.role) console.log(chalk.dim(`  Role: ${agent.role}`));
    console.log();

    // Stats bar
    console.log(`  ${chalk.yellow(String(pending.length))} pending  ${chalk.blue(String(inProgress.length))} active  ${chalk.green(String(completed.length))} done  ${chalk.dim(`${rate}% rate`)}`);
    console.log();

    // Active tasks
    if (inProgress.length > 0) {
      console.log(chalk.bold("  In progress:"));
      for (const t of inProgress) {
        const id = t.short_id || t.id.slice(0, 8);
        const staleFlag = new Date(t.updated_at).getTime() < Date.now() - 30 * 60 * 1000 ? chalk.red(" [stale]") : "";
        console.log(`    ${chalk.cyan(id)} ${chalk.yellow(t.priority)} ${t.title}${staleFlag}`);
      }
      console.log();
    }

    // Pending tasks (up to 5)
    if (pending.length > 0) {
      console.log(chalk.bold(`  Pending (${pending.length}):`));
      for (const t of pending.slice(0, 5)) {
        const id = t.short_id || t.id.slice(0, 8);
        const due = t.due_at ? chalk.dim(` due:${t.due_at.slice(0, 10)}`) : "";
        console.log(`    ${chalk.dim(id)} ${t.priority.padEnd(8)} ${t.title}${due}`);
      }
      if (pending.length > 5) console.log(chalk.dim(`    ... and ${pending.length - 5} more`));
      console.log();
    }

    // Recent completions (up to 3)
    const recentDone = completed.filter(t => t.completed_at).sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime()).slice(0, 3);
    if (recentDone.length > 0) {
      console.log(chalk.bold("  Recently completed:"));
      for (const t of recentDone) {
        const id = t.short_id || t.id.slice(0, 8);
        const when = t.completed_at ? chalk.dim(new Date(t.completed_at).toLocaleDateString()) : "";
        console.log(`    ${chalk.green("✓")} ${chalk.dim(id)} ${t.title} ${when}`);
      }
      console.log();
    }

    if (allTasks.length === 0) {
      console.log(chalk.dim("  No tasks assigned to this agent."));
    }
  });

// org
program
  .command("org")
  .description("Show agent org chart — who reports to who")
  .option("--set <agent=manager>", "Set reporting: 'seneca=julius' or 'seneca=' to clear")
  .action((opts) => {
    const globalOpts = program.opts();
    const { getOrgChart, getAgentByName: getByName, updateAgent: update } = require("../db/agents.js");

    if (opts.set) {
      const [agentName, managerName] = opts.set.split("=");
      const agent = getByName(agentName);
      if (!agent) { console.error(chalk.red(`Agent not found: ${agentName}`)); process.exit(1); }
      let managerId: string | null = null;
      if (managerName) {
        const manager = getByName(managerName);
        if (!manager) { console.error(chalk.red(`Manager not found: ${managerName}`)); process.exit(1); }
        managerId = manager.id;
      }
      update(agent.id, { reports_to: managerId });
      if (globalOpts.json) { output({ agent: agentName, reports_to: managerName || null }, true); }
      else { console.log(chalk.green(managerId ? `${agentName} → ${managerName}` : `${agentName} → (top-level)`)); }
      return;
    }

    const tree = getOrgChart();
    if (globalOpts.json) { output(tree, true); return; }
    if (tree.length === 0) { console.log(chalk.dim("No agents registered.")); return; }

    function render(nodes: any[], indent = 0): void {
      for (const n of nodes) {
        const prefix = "  ".repeat(indent);
        const title = n.agent.title ? chalk.cyan(` — ${n.agent.title}`) : "";
        const level = n.agent.level ? chalk.dim(` (${n.agent.level})`) : "";
        console.log(`${prefix}${indent > 0 ? "├── " : ""}${chalk.bold(n.agent.name)}${title}${level}`);
        render(n.reports, indent + 1);
      }
    }
    render(tree);
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

// config
program
  .command("config")
  .description("View or update configuration")
  .option("--get <key>", "Get a config value")
  .option("--set <key=value>", "Set a config value (e.g. completion_guard.enabled=true)")
  .action((opts) => {
    const globalOpts = program.opts();
    const configPath = join(process.env["HOME"] || "~", ".todos", "config.json");

    if (opts.get) {
      const config = loadConfig();
      const keys = opts.get.split(".");
      let value: any = config;
      for (const k of keys) { value = value?.[k]; }
      if (globalOpts.json) {
        output({ key: opts.get, value }, true);
      } else {
        console.log(value !== undefined ? JSON.stringify(value, null, 2) : chalk.dim("(not set)"));
      }
      return;
    }

    if (opts.set) {
      const [key, ...valueParts] = opts.set.split("=");
      const rawValue = valueParts.join("=");
      let parsedValue: any;
      try { parsedValue = JSON.parse(rawValue); } catch { parsedValue = rawValue; }

      let config: any = {};
      try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}

      const keys = key.split(".");
      let obj = config;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]] || typeof obj[keys[i]] !== "object") obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = parsedValue;

      const dir = dirname(configPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      if (globalOpts.json) {
        output({ key, value: parsedValue }, true);
      } else {
        console.log(chalk.green(`Set ${key} = ${JSON.stringify(parsedValue)}`));
      }
      return;
    }

    // No args: show full config
    const config = loadConfig();
    if (globalOpts.json) {
      output(config, true);
    } else {
      console.log(JSON.stringify(config, null, 2));
    }
  });

// serve (web dashboard)
program
  .command("serve")
  .description("Start the web dashboard")
  .option("--port <port>", "Port number", "19427")
  .option("--host <host>", "Host to bind (default: 127.0.0.1 localhost only, use 0.0.0.0 for all interfaces)")
  .option("--no-open", "Don't open browser automatically")
  .action(async (opts) => {
    const { startServer } = await import("../server/serve.js");
    const requestedPort = parseInt(opts.port, 10);
    let port = requestedPort;
    // Auto-find free port if default is in use
    for (let p = requestedPort; p < requestedPort + 100; p++) {
      try {
        const s = Bun.serve({ port: p, fetch: () => new Response("") });
        s.stop(true);
        port = p;
        break;
      } catch { /* port in use */ }
    }
    if (port !== requestedPort) {
      console.log(`Port ${requestedPort} in use, using ${port}`);
    }
    await startServer(port, { open: opts.open !== false, host: opts.host });
  });

// watch
program
  .command("watch")
  .description("Live-updating task list (refreshes every few seconds)")
  .option("-s, --status <status>", "Filter by status (default: pending,in_progress)")
  .option("-i, --interval <seconds>", "Refresh interval in seconds", "5")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts);
    const interval = parseInt(opts.interval, 10) * 1000;
    const statusFilter = opts.status ? opts.status.split(",").map((s: string) => s.trim()) : ["pending", "in_progress"];

    function render() {
      const tasks = listTasks({ project_id: projectId, status: statusFilter as any });
      const all = listTasks({ project_id: projectId });
      const counts: Record<string, number> = {};
      for (const t of all) counts[t.status] = (counts[t.status] || 0) + 1;

      // Clear screen
      process.stdout.write("\x1B[2J\x1B[0f");

      // Header
      const now = new Date().toLocaleTimeString();
      console.log(chalk.bold(`todos watch`) + chalk.dim(` — ${now} — refreshing every ${opts.interval}s — Ctrl+C to stop\n`));

      // Stats line
      const parts = [
        `total: ${chalk.bold(String(all.length))}`,
        `pending: ${chalk.yellow(String(counts["pending"] || 0))}`,
        `in_progress: ${chalk.blue(String(counts["in_progress"] || 0))}`,
        `completed: ${chalk.green(String(counts["completed"] || 0))}`,
        `failed: ${chalk.red(String(counts["failed"] || 0))}`,
      ];
      console.log(parts.join("  ") + "\n");

      if (tasks.length === 0) {
        console.log(chalk.dim("No matching tasks."));
        return;
      }

      for (const t of tasks) {
        console.log(formatTaskLine(t));
      }
      console.log(chalk.dim(`\n${tasks.length} task(s) shown`));
    }

    render();
    const timer = setInterval(render, interval);

    process.on("SIGINT", () => {
      clearInterval(timer);
      process.exit(0);
    });

    // Keep alive
    await new Promise(() => {});
  });

// stream — SSE task event stream
program
  .command("stream")
  .description("Subscribe to real-time task events via SSE (requires todos serve)")
  .option("--agent <id>", "Filter to events for a specific agent")
  .option("--events <list>", "Comma-separated event types (default: all)", "task.created,task.started,task.completed,task.failed,task.assigned,task.status_changed")
  .option("--port <n>", "Server port", "3000")
  .option("--json", "Output raw JSON events")
  .action(async (opts) => {
    const baseUrl = `http://localhost:${opts.port}`;
    const params = new URLSearchParams();
    if (opts.agent) params.set("agent_id", opts.agent);
    if (opts.events) params.set("events", opts.events);
    const url = `${baseUrl}/api/tasks/stream?${params}`;

    const eventColors: Record<string, (s: string) => string> = {
      "task.created": chalk.blue,
      "task.started": chalk.cyan,
      "task.completed": chalk.green,
      "task.failed": chalk.red,
      "task.assigned": chalk.yellow,
      "task.status_changed": chalk.magenta,
    };

    console.log(chalk.dim(`Connecting to ${url} — Ctrl+C to stop\n`));

    try {
      const resp = await fetch(url);
      if (!resp.ok || !resp.body) {
        console.error(chalk.red(`Failed to connect: ${resp.status}`));
        process.exit(1);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        let eventName = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "connected") continue;
              if (opts.json) {
                console.log(JSON.stringify({ event: eventName, ...data }));
              } else {
                const colorFn = eventColors[eventName] || chalk.white;
                const ts = new Date(data.timestamp || Date.now()).toLocaleTimeString();
                const taskId = data.task_id ? data.task_id.slice(0, 8) : "";
                const agentInfo = data.agent_id ? ` [${data.agent_id}]` : "";
                console.log(`${chalk.dim(ts)} ${colorFn(eventName.padEnd(25))} ${taskId}${agentInfo}`);
              }
            } catch {}
            eventName = "";
          }
        }
      }
    } catch (e) {
      console.error(chalk.red(`Connection error: ${e instanceof Error ? e.message : e}`));
      console.error(chalk.dim("Is `todos serve` running?"));
      process.exit(1);
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

// blame
program
  .command("blame <file>")
  .description("Show which tasks/agents touched a file and why — combines task_files + task_commits")
  .action((filePath: string) => {
    const globalOpts = program.opts();
    const { findTasksByFile } = require("../db/task-files.js") as any;
    const { getTask } = require("../db/tasks.js") as any;
    const db = getDatabase();

    // Find via task_files
    const taskFiles = findTasksByFile(filePath, db) as any[];

    // Find via task_commits (search files_changed JSON)
    const commitRows = db.query(
      "SELECT tc.*, t.title, t.short_id FROM task_commits tc JOIN tasks t ON t.id = tc.task_id WHERE tc.files_changed LIKE ? ORDER BY tc.committed_at DESC"
    ).all(`%${filePath}%`) as any[];

    if (globalOpts.json) {
      output({ file: filePath, task_files: taskFiles, commits: commitRows }, true);
      return;
    }

    console.log(chalk.bold(`\nBlame: ${filePath}\n`));

    if (taskFiles.length > 0) {
      console.log(chalk.bold("Task File Links:"));
      for (const tf of taskFiles) {
        const task = getTask(tf.task_id, db);
        const title = task ? task.title : "unknown";
        const sid = task?.short_id || tf.task_id.slice(0, 8);
        console.log(`  ${chalk.cyan(sid)} ${title} — ${chalk.dim(tf.role || "file")} ${chalk.dim(tf.updated_at)}`);
      }
    }

    if (commitRows.length > 0) {
      console.log(chalk.bold(`\nCommit Links (${commitRows.length}):`));
      for (const c of commitRows) {
        const sid = c.short_id || c.task_id.slice(0, 8);
        console.log(`  ${chalk.yellow(c.sha?.slice(0, 7) || "?")} ${chalk.cyan(sid)} ${c.title || ""} — ${chalk.dim(c.author || "")} ${chalk.dim(c.committed_at || "")}`);
      }
    }

    if (taskFiles.length === 0 && commitRows.length === 0) {
      console.log(chalk.dim("No task or commit links found for this file."));
      console.log(chalk.dim("Use 'todos hook install' to auto-link future commits."));
    }
    console.log();
  });

// dashboard
program
  .command("dashboard")
  .description("Live-updating dashboard showing project health, agents, task flow")
  .option("--project <id>", "Filter to project")
  .option("--refresh <ms>", "Refresh interval in ms (default: 2000)", "2000")
  .action(async (opts) => {
    const { render } = await import("ink");
    const React = await import("react");
    const { Dashboard } = await import("./components/Dashboard.js");
    const globalOpts = program.opts();
    const projectId = opts.project || autoProject(globalOpts) || undefined;
    render(React.createElement(Dashboard, { projectId, refreshMs: parseInt(opts.refresh, 10) }));
  });

// next
program
  .command("next")
  .description("Show the best pending task to work on next")
  .option("--agent <id>", "Prefer tasks assigned to this agent")
  .option("--project <id>", "Filter to project")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const db = getDatabase();
    const filters: Record<string, string> = {};
    if (opts.project) filters.project_id = opts.project;
    const task = getNextTask(opts.agent, Object.keys(filters).length ? filters : undefined, db);
    if (!task) {
      console.log(chalk.dim("No tasks available."));
      return;
    }
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.bold("Next task:"));
    console.log(`  ${chalk.cyan(task.short_id || task.id.slice(0, 8))} ${chalk.yellow(task.priority)} ${task.title}`);
    if (task.description) console.log(chalk.dim(`  ${task.description.slice(0, 100)}`));
  });

// claim
program
  .command("claim <agent>")
  .description("Atomically claim the best pending task for an agent")
  .option("--project <id>", "Filter to project")
  .option("--json", "Output as JSON")
  .action(async (agent, opts) => {
    const db = getDatabase();
    const filters: Record<string, string> = {};
    if (opts.project) filters.project_id = opts.project;
    const task = claimNextTask(agent, Object.keys(filters).length ? filters : undefined, db);
    if (!task) {
      console.log(chalk.dim("No tasks available to claim."));
      return;
    }
    if (opts.json) { console.log(JSON.stringify(task, null, 2)); return; }
    console.log(chalk.green(`Claimed: ${task.short_id || task.id.slice(0, 8)} | ${task.priority} | ${task.title}`));
  });

// steal
program
  .command("steal <agent>")
  .description("Work-stealing: take the highest-priority stale task from another agent")
  .option("--stale-minutes <n>", "How long a task must be stale (default: 30)", "30")
  .option("--project <id>", "Filter to project")
  .action((agent, opts) => {
    const globalOpts = program.opts();
    const { stealTask } = require("../db/tasks.js") as any;
    const task = stealTask(agent, { stale_minutes: parseInt(opts.staleMinutes, 10), project_id: opts.project });
    if (!task) { console.log(chalk.dim("No stale tasks available to steal.")); return; }
    if (globalOpts.json) { output(task, true); return; }
    console.log(chalk.green(`Stolen: ${task.short_id || task.id.slice(0, 8)} | ${task.priority} | ${task.title}`));
  });

// status
program
  .command("status")
  .description("Show full project health snapshot")
  .option("--agent <id>", "Include next task for this agent")
  .option("--project <id>", "Filter to project")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const db = getDatabase();
    const filters: Record<string, string> = {};
    if (opts.project) filters.project_id = opts.project;
    const s = getStatus(Object.keys(filters).length ? filters : undefined, opts.agent, undefined, db);
    if (opts.json) { console.log(JSON.stringify(s, null, 2)); return; }
    console.log(`Tasks: ${chalk.yellow(s.pending)} pending | ${chalk.blue(s.in_progress)} active | ${chalk.green(s.completed)} done | ${s.total} total`);
    if (s.stale_count > 0) console.log(chalk.red(`⚠️  ${s.stale_count} stale tasks (stuck in_progress)`));
    if (s.overdue_recurring > 0) console.log(chalk.yellow(`🔁 ${s.overdue_recurring} overdue recurring`));
    if (s.active_work.length > 0) {
      console.log(chalk.bold("\nActive:"));
      for (const w of s.active_work.slice(0, 5)) {
        const id = w.short_id || w.id.slice(0, 8);
        console.log(`  ${chalk.cyan(id)} | ${w.assigned_to || w.locked_by || '?'} | ${w.title}`);
      }
    }
    if (s.next_task) {
      console.log(chalk.bold("\nNext up:"));
      const t = s.next_task;
      console.log(`  ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${chalk.yellow(t.priority)} ${t.title}`);
    }
  });

// recap
program
  .command("recap")
  .description("Show what happened in the last N hours — completed tasks, new tasks, agent activity, blockers")
  .option("--hours <n>", "Look back N hours (default: 8)", "8")
  .option("--project <id>", "Filter to project")
  .action((opts) => {
    const globalOpts = program.opts();
    const { getRecap } = require("../db/audit.js") as any;
    const recap = getRecap(parseInt(opts.hours, 10), opts.project);
    if (globalOpts.json) { output(recap, true); return; }

    console.log(chalk.bold(`\nRecap — last ${recap.hours} hours (since ${new Date(recap.since).toLocaleString()})\n`));

    if (recap.completed.length > 0) {
      console.log(chalk.green.bold(`Completed (${recap.completed.length}):`));
      for (const t of recap.completed) {
        const id = t.short_id || t.id.slice(0, 8);
        const dur = t.duration_minutes != null ? ` (${t.duration_minutes}m)` : "";
        console.log(`  ${chalk.green("✓")} ${chalk.cyan(id)} ${t.title}${dur}${t.assigned_to ? ` — ${chalk.dim(t.assigned_to)}` : ""}`);
      }
    } else {
      console.log(chalk.dim("No tasks completed in this period."));
    }

    if (recap.in_progress.length > 0) {
      console.log(chalk.blue.bold(`\nIn Progress (${recap.in_progress.length}):`));
      for (const t of recap.in_progress) {
        const id = t.short_id || t.id.slice(0, 8);
        console.log(`  ${chalk.blue("→")} ${chalk.cyan(id)} ${t.title}${t.assigned_to ? ` — ${chalk.dim(t.assigned_to)}` : ""}`);
      }
    }

    if (recap.blocked.length > 0) {
      console.log(chalk.red.bold(`\nBlocked (${recap.blocked.length}):`));
      for (const t of recap.blocked) {
        const id = t.short_id || t.id.slice(0, 8);
        console.log(`  ${chalk.red("✗")} ${chalk.cyan(id)} ${t.title}`);
      }
    }

    if (recap.stale.length > 0) {
      console.log(chalk.yellow.bold(`\nStale (${recap.stale.length}):`));
      for (const t of recap.stale) {
        const id = t.short_id || t.id.slice(0, 8);
        const ago = Math.round((Date.now() - new Date(t.updated_at).getTime()) / 60000);
        console.log(`  ${chalk.yellow("!")} ${chalk.cyan(id)} ${t.title} — last update ${ago}m ago`);
      }
    }

    if (recap.created.length > 0) {
      console.log(chalk.dim.bold(`\nCreated (${recap.created.length}):`));
      for (const t of recap.created.slice(0, 10)) {
        const id = t.short_id || t.id.slice(0, 8);
        console.log(`  ${chalk.dim("+")} ${chalk.cyan(id)} ${t.title}`);
      }
      if (recap.created.length > 10) console.log(chalk.dim(`  ... and ${recap.created.length - 10} more`));
    }

    if (recap.agents.length > 0) {
      console.log(chalk.bold(`\nAgents:`));
      for (const a of recap.agents) {
        const seen = Math.round((Date.now() - new Date(a.last_seen_at).getTime()) / 60000);
        console.log(`  ${a.name}: ${chalk.green(a.completed_count + " done")} | ${chalk.blue(a.in_progress_count + " active")} | last seen ${seen}m ago`);
      }
    }
    console.log();
  });

// standup
program
  .command("standup")
  .description("Generate standup notes — completed since yesterday, in progress, blocked. Grouped by agent.")
  .option("--since <date>", "ISO date or 'yesterday' (default: yesterday)")
  .option("--project <id>", "Filter to project")
  .action((opts) => {
    const globalOpts = program.opts();
    const sinceDate = opts.since === "yesterday" || !opts.since
      ? new Date(Date.now() - 24 * 60 * 60 * 1000)
      : new Date(opts.since);
    const hours = Math.max(1, Math.round((Date.now() - sinceDate.getTime()) / (60 * 60 * 1000)));
    const { getRecap } = require("../db/audit.js") as any;
    const recap = getRecap(hours, opts.project);

    if (globalOpts.json) { output(recap, true); return; }

    console.log(chalk.bold(`\nStandup — since ${sinceDate.toLocaleDateString()}\n`));

    // Group completed by agent
    const byAgent = new Map<string, any[]>();
    for (const t of recap.completed) {
      const agent = t.assigned_to || "unassigned";
      if (!byAgent.has(agent)) byAgent.set(agent, []);
      byAgent.get(agent)!.push(t);
    }

    if (byAgent.size > 0) {
      console.log(chalk.green.bold("Done:"));
      for (const [agent, tasks] of byAgent) {
        console.log(`  ${chalk.cyan(agent)}:`);
        for (const t of tasks) {
          const dur = t.duration_minutes != null ? ` (${t.duration_minutes}m)` : "";
          console.log(`    ${chalk.green("✓")} ${t.short_id || t.id.slice(0, 8)} ${t.title}${dur}`);
        }
      }
    } else {
      console.log(chalk.dim("Nothing completed."));
    }

    if (recap.in_progress.length > 0) {
      console.log(chalk.blue.bold("\nIn Progress:"));
      for (const t of recap.in_progress) {
        console.log(`  ${chalk.blue("→")} ${t.short_id || t.id.slice(0, 8)} ${t.title}${t.assigned_to ? ` — ${chalk.dim(t.assigned_to)}` : ""}`);
      }
    }

    if (recap.blocked.length > 0) {
      console.log(chalk.red.bold("\nBlocked:"));
      for (const t of recap.blocked) {
        console.log(`  ${chalk.red("✗")} ${t.short_id || t.id.slice(0, 8)} ${t.title}`);
      }
    }
    console.log();
  });

// fail
program
  .command("fail <id>")
  .description("Mark a task as failed with optional reason and retry")
  .option("--reason <text>", "Why it failed")
  .option("--agent <id>", "Agent reporting the failure")
  .option("--retry", "Auto-create a retry copy")
  .option("--json", "Output as JSON")
  .action(async (id, opts) => {
    const db = getDatabase();
    const resolvedId = resolvePartialId(db, "tasks", id);
    if (!resolvedId) { console.error(chalk.red(`Task not found: ${id}`)); process.exit(1); }
    const result = failTask(resolvedId, opts.agent, opts.reason, { retry: opts.retry }, db);
    if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
    console.log(chalk.red(`Failed: ${result.task.short_id || result.task.id.slice(0, 8)} | ${result.task.title}`));
    if (opts.reason) console.log(chalk.dim(`Reason: ${opts.reason}`));
    if (result.retryTask) console.log(chalk.yellow(`Retry created: ${result.retryTask.short_id || result.retryTask.id.slice(0, 8)} | ${result.retryTask.title}`));
  });

// active
program
  .command("active")
  .description("Show all currently in-progress tasks")
  .option("--project <id>", "Filter to project")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const db = getDatabase();
    const filters: Record<string, string> = {};
    if (opts.project) filters.project_id = opts.project;
    const work = getActiveWork(Object.keys(filters).length ? filters : undefined, db);
    if (opts.json) { console.log(JSON.stringify(work, null, 2)); return; }
    if (work.length === 0) { console.log(chalk.dim("No active work.")); return; }
    console.log(chalk.bold(`Active work (${work.length}):`));
    for (const w of work) {
      const id = w.short_id || w.id.slice(0, 8);
      const agent = w.assigned_to || w.locked_by || 'unassigned';
      console.log(`  ${chalk.cyan(id)} | ${chalk.yellow(w.priority)} | ${agent.padEnd(12)} | ${w.title}`);
    }
  });

// stale
program
  .command("stale")
  .description("Find tasks stuck in_progress with no recent activity")
  .option("--minutes <n>", "Stale threshold in minutes", "30")
  .option("--project <id>", "Filter to project")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const db = getDatabase();
    const filters: Record<string, string> = {};
    if (opts.project) filters.project_id = opts.project;
    const tasks = getStaleTasks(parseInt(opts.minutes, 10), Object.keys(filters).length ? filters : undefined, db);
    if (opts.json) { console.log(JSON.stringify(tasks, null, 2)); return; }
    if (tasks.length === 0) { console.log(chalk.dim("No stale tasks.")); return; }
    console.log(chalk.bold(`Stale tasks (${tasks.length}):`));
    for (const t of tasks) {
      const id = t.short_id || t.id.slice(0, 8);
      const staleMin = Math.round((Date.now() - new Date(t.updated_at).getTime()) / 60000);
      console.log(`  ${chalk.cyan(id)} | ${t.locked_by || t.assigned_to || '?'} | ${t.title} ${chalk.dim(`(${staleMin}min stale)`)}`);
    }
  });

// redistribute
program
  .command("redistribute <agent>")
  .description("Release stale in-progress tasks and claim the best one (work-stealing)")
  .option("--max-age <minutes>", "Stale threshold in minutes", "60")
  .option("--project <id>", "Limit to a specific project")
  .option("--limit <n>", "Max stale tasks to release")
  .option("--json", "Output as JSON")
  .action(async (agent: string, opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const projectId = opts.project ? resolveTaskId(opts.project) : autoProject(globalOpts) ?? undefined;
    const result = redistributeStaleTasks(agent, {
      max_age_minutes: parseInt(opts.maxAge, 10),
      project_id: projectId,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    }, db);
    if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
    console.log(chalk.bold(`Released ${result.released.length} stale task(s).`));
    for (const t of result.released) {
      const id = t.short_id || t.id.slice(0, 8);
      console.log(`  ${chalk.yellow("released")} ${chalk.cyan(id)} ${t.title}`);
    }
    if (result.claimed) {
      const id = result.claimed.short_id || result.claimed.id.slice(0, 8);
      console.log(chalk.green(`\nClaimed: ${chalk.cyan(id)} ${result.claimed.title}`));
    } else {
      console.log(chalk.dim("\nNo task claimed (nothing available)."));
    }
  });

// assign
program
  .command("assign <id> <agent>")
  .description("Assign a task to an agent")
  .option("--json", "Output as JSON")
  .action((id: string, agent: string, opts) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const db = getDatabase();
    const task = getTask(resolvedId, db);
    if (!task) { console.error(chalk.red(`Task not found: ${id}`)); process.exit(1); }
    try {
      const updated = updateTask(resolvedId, { assigned_to: agent, version: task.version }, db);
      if (opts.json || globalOpts.json) { console.log(JSON.stringify(updated)); return; }
      console.log(chalk.green(`Assigned to ${agent}: ${formatTaskLine(updated)}`));
    } catch { handleError(new Error("Failed to assign")); }
  });

// unassign
program
  .command("unassign <id>")
  .description("Remove task assignment")
  .option("--json", "Output as JSON")
  .action((id: string, opts) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const db = getDatabase();
    const task = getTask(resolvedId, db);
    if (!task) { console.error(chalk.red(`Task not found: ${id}`)); process.exit(1); }
    try {
      const updated = updateTask(resolvedId, { assigned_to: undefined, version: task.version }, db);
      if (opts.json || globalOpts.json) { console.log(JSON.stringify(updated)); return; }
      console.log(chalk.green(`Unassigned: ${formatTaskLine(updated)}`));
    } catch { handleError(new Error("Failed to unassign")); }
  });

// tag
program
  .command("tag <id> <tag>")
  .description("Add a tag to a task")
  .option("--json", "Output as JSON")
  .action((id: string, tag: string, opts) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const db = getDatabase();
    const task = getTask(resolvedId, db);
    if (!task) { console.error(chalk.red(`Task not found: ${id}`)); process.exit(1); }
    const newTags = [...new Set([...task.tags, tag])];
    try {
      const updated = updateTask(resolvedId, { tags: newTags, version: task.version }, db);
      if (opts.json || globalOpts.json) { console.log(JSON.stringify(updated)); return; }
      console.log(chalk.green(`Tagged [${tag}]: ${formatTaskLine(updated)}`));
    } catch { handleError(new Error("Failed to tag")); }
  });

// untag
program
  .command("untag <id> <tag>")
  .description("Remove a tag from a task")
  .option("--json", "Output as JSON")
  .action((id: string, tag: string, opts) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const db = getDatabase();
    const task = getTask(resolvedId, db);
    if (!task) { console.error(chalk.red(`Task not found: ${id}`)); process.exit(1); }
    const newTags = task.tags.filter(t => t !== tag);
    try {
      const updated = updateTask(resolvedId, { tags: newTags, version: task.version }, db);
      if (opts.json || globalOpts.json) { console.log(JSON.stringify(updated)); return; }
      console.log(chalk.green(`Untagged [${tag}]: ${formatTaskLine(updated)}`));
    } catch { handleError(new Error("Failed to untag")); }
  });

// pin
program
  .command("pin <id>")
  .description("Escalate task to critical priority")
  .option("--json", "Output as JSON")
  .action((id: string, opts) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const db = getDatabase();
    const { setTaskPriority } = require("../db/tasks.js") as any;
    try {
      const updated = setTaskPriority(resolvedId, "critical", undefined, db);
      if (opts.json || globalOpts.json) { console.log(JSON.stringify(updated)); return; }
      console.log(chalk.red(`📌 Pinned (critical): ${formatTaskLine(updated)}`));
    } catch { handleError(new Error("Failed to pin")); }
  });

// summary — markdown summary for standups, PRs, handoffs
program
  .command("summary")
  .description("Generate a markdown summary of recent task activity")
  .option("--days <n>", "Days of history to include", "7")
  .option("--project <id>", "Filter to project")
  .option("--agent <id>", "Filter to agent")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const days = parseInt(opts.days, 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const projectId = opts.project || autoProject(globalOpts);

    const filter: Record<string, unknown> = {};
    if (projectId) filter.project_id = projectId;
    if (opts.agent) filter.assigned_to = opts.agent;

    const { getTasksChangedSince } = require("../db/tasks.js") as any;
    const changed = getTasksChangedSince(since, Object.keys(filter).length ? filter : undefined, db) as any[];
    const completed = changed.filter((t: any) => t.status === "completed");
    const inProgress = changed.filter((t: any) => t.status === "in_progress");
    const failed = changed.filter((t: any) => t.status === "failed");
    const allTasks = listTasks({ ...(filter as any), status: "pending" as any });

    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify({ completed, in_progress: inProgress, failed, pending: allTasks.length, period_days: days }, null, 2));
      return;
    }

    const lines: string[] = [];
    lines.push(`## Task Summary — Last ${days} day${days !== 1 ? "s" : ""}`);
    lines.push(`*${new Date().toLocaleDateString()}*\n`);

    if (completed.length > 0) {
      lines.push(`### ✅ Completed (${completed.length})`);
      for (const t of completed) {
        const id = t.short_id || t.id.slice(0, 8);
        const who = t.assigned_to ? ` — ${t.assigned_to}` : "";
        lines.push(`- **${id}**: ${t.title}${who}`);
      }
      lines.push("");
    }

    if (inProgress.length > 0) {
      lines.push(`### 🔄 In Progress (${inProgress.length})`);
      for (const t of inProgress) {
        const id = t.short_id || t.id.slice(0, 8);
        const who = t.assigned_to ? ` — ${t.assigned_to}` : "";
        lines.push(`- **${id}**: ${t.title}${who}`);
      }
      lines.push("");
    }

    if (failed.length > 0) {
      lines.push(`### ❌ Failed (${failed.length})`);
      for (const t of failed) {
        const id = t.short_id || t.id.slice(0, 8);
        lines.push(`- **${id}**: ${t.title}`);
      }
      lines.push("");
    }

    lines.push(`### 📋 Pending: ${allTasks.length} task${allTasks.length !== 1 ? "s" : ""} remaining`);

    console.log(lines.join("\n"));
  });

// doctor
program
  .command("doctor")
  .description("Diagnose common task data issues")
  .option("--fix", "Auto-fix recoverable issues where possible")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const issues: { severity: "error" | "warn" | "info"; type: string; message: string; count?: number }[] = [];

    // 1. Stale in-progress tasks
    const stale = listTasks({ status: "in_progress" as any }).filter(
      t => new Date(t.updated_at).getTime() < Date.now() - 30 * 60 * 1000
    );
    if (stale.length > 0) issues.push({ severity: "warn", type: "stale_tasks", message: `${stale.length} tasks stuck in_progress >30min`, count: stale.length });

    // 2. Tasks with invalid recurrence rules
    const { isValidRecurrenceRule } = require("../lib/recurrence.js") as any;
    const recurring = listTasks({ status: ["pending", "in_progress"] as any }).filter(t => (t as any).recurrence_rule);
    const invalidRecurrence = recurring.filter(t => !(isValidRecurrenceRule as any)((t as any).recurrence_rule));
    if (invalidRecurrence.length > 0) issues.push({ severity: "error", type: "invalid_recurrence", message: `${invalidRecurrence.length} tasks with invalid recurrence_rule`, count: invalidRecurrence.length });

    // 3. Overdue recurring tasks
    const nowStr = new Date().toISOString();
    const overdueRecurring = recurring.filter(t => (t as any).due_at && (t as any).due_at < nowStr);
    if (overdueRecurring.length > 0) issues.push({ severity: "warn", type: "overdue_recurring", message: `${overdueRecurring.length} recurring tasks past due date`, count: overdueRecurring.length });

    // 4. Tasks with orphaned parent IDs
    const allIds = new Set(listTasks({}).map(t => t.id));
    const withParent = db.query("SELECT id, parent_id FROM tasks WHERE parent_id IS NOT NULL").all() as { id: string; parent_id: string }[];
    const orphaned = withParent.filter(t => !allIds.has(t.parent_id));
    if (orphaned.length > 0) issues.push({ severity: "error", type: "orphaned_parents", message: `${orphaned.length} tasks reference non-existent parent IDs`, count: orphaned.length });

    // 5. Healthy
    if (issues.length === 0) issues.push({ severity: "info", type: "healthy", message: "No issues found" });

    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify({ issues, ok: !issues.some(i => i.severity === "error") }));
      return;
    }

    console.log(chalk.bold("todos doctor\n"));
    for (const issue of issues) {
      const icon = issue.severity === "error" ? chalk.red("✗") : issue.severity === "warn" ? chalk.yellow("⚠") : chalk.green("✓");
      console.log(`  ${icon} ${issue.message}`);
    }
    const errors = issues.filter(i => i.severity === "error").length;
    const warns = issues.filter(i => i.severity === "warn").length;
    if (errors === 0 && warns === 0) console.log(chalk.green("\n  All clear."));
    else console.log(chalk[errors > 0 ? "red" : "yellow"](`\n  ${errors} error(s), ${warns} warning(s). Run with --fix to auto-resolve where possible.`));
  });

// health
program
  .command("health")
  .description("Check todos system health — database, config, connectivity")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const checks: { name: string; ok: boolean; message: string }[] = [];

    // 1. Database check
    try {
      const db = getDatabase();
      const row = db.query("SELECT COUNT(*) as count FROM tasks").get() as { count: number };
      const { statSync } = require("node:fs") as typeof import("node:fs");
      const dbPath = process.env["TODOS_DB_PATH"] || require("node:path").join(process.env["HOME"] || "~", ".todos", "todos.db");
      let size = "unknown";
      try { size = `${(statSync(dbPath).size / 1024 / 1024).toFixed(1)} MB`; } catch {}
      checks.push({ name: "Database", ok: true, message: `${row.count} tasks · ${size} · ${chalk.dim(dbPath)}` });
    } catch (e) {
      checks.push({ name: "Database", ok: false, message: e instanceof Error ? e.message : "Failed" });
    }

    // 2. Migration check
    try {
      const db = getDatabase();
      const row = db.query("SELECT MAX(id) as max_id FROM _migrations").get() as { max_id: number };
      checks.push({ name: "Migrations", ok: true, message: `Schema at migration ${row.max_id}` });
    } catch {
      checks.push({ name: "Migrations", ok: false, message: "Could not read migration version" });
    }

    // 3. Config check
    try {
      const { loadConfig } = require("../lib/config.js") as any;
      loadConfig();
      checks.push({ name: "Config", ok: true, message: "Loaded successfully" });
    } catch (e) {
      checks.push({ name: "Config", ok: false, message: e instanceof Error ? e.message : "Failed" });
    }

    // 4. Task stats
    try {
      const allTasks = listTasks({});
      const stale = allTasks.filter(t => t.status === "in_progress" && new Date(t.updated_at).getTime() < Date.now() - 30 * 60 * 1000);
      const overdue = allTasks.filter(t => t.recurrence_rule && t.status === "pending" && t.due_at && t.due_at < new Date().toISOString());
      const msg = `${allTasks.length} tasks${stale.length > 0 ? ` · ${stale.length} stale` : ""}${overdue.length > 0 ? ` · ${overdue.length} overdue recurring` : ""}`;
      checks.push({ name: "Tasks", ok: stale.length === 0 && overdue.length === 0, message: msg });
    } catch (e) {
      checks.push({ name: "Tasks", ok: false, message: "Failed to read tasks" });
    }

    // Version check
    checks.push({ name: "Version", ok: true, message: `v${getPackageVersion()} · todos-mcp, todos-serve` });

    if (opts.json || globalOpts.json) {
      const ok = checks.every(c => c.ok);
      console.log(JSON.stringify({ ok, checks }));
      return;
    }

    console.log(chalk.bold("todos health\n"));
    for (const c of checks) {
      const icon = c.ok ? chalk.green("✓") : chalk.yellow("⚠");
      console.log(`  ${icon} ${c.name.padEnd(14)} ${c.message}`);
    }
    const allOk = checks.every(c => c.ok);
    console.log(`\n  ${allOk ? chalk.green("All checks passed.") : chalk.yellow("Some checks need attention.")}`);
  });

// report
program
  .command("report")
  .description("Analytics report: task activity, completion rates, agent breakdown")
  .option("--days <n>", "Days to include in report", "7")
  .option("--project <id>", "Filter to project")
  .option("--markdown", "Output as markdown")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const days = parseInt(opts.days, 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const projectId = opts.project || autoProject(globalOpts);

    const filter: Record<string, unknown> = {};
    if (projectId) filter.project_id = projectId;

    const { getTasksChangedSince, getTaskStats } = require("../db/tasks.js") as any;
    const changed: any[] = getTasksChangedSince(since, Object.keys(filter).length ? filter : undefined, db);
    const completed = changed.filter((t: any) => t.status === "completed");
    const failed = changed.filter((t: any) => t.status === "failed");
    const all = listTasks(filter as any);
    const stats = getTaskStats(Object.keys(filter).length ? filter : undefined, db) as any;

    // By-day activity (count tasks updated per day)
    const byDay: Record<string, number> = {};
    for (const t of changed) {
      const day = t.updated_at.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    }
    const dayValues = Object.values(byDay) as number[];
    const maxDay = Math.max(...dayValues, 1);
    const sparkline = dayValues.map(v => "▁▂▃▄▅▆▇█"[Math.min(7, Math.floor((v / maxDay) * 7))] || "▁").join("");

    // By agent
    const byAgent: Record<string, number> = {};
    for (const t of completed) {
      const agent = t.assigned_to || "unassigned";
      byAgent[agent] = (byAgent[agent] || 0) + 1;
    }

    const completionRate = changed.length > 0 ? Math.round((completed.length / changed.length) * 100) : 0;

    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify({ days, period_since: since, changed: changed.length, completed: completed.length, failed: failed.length, completion_rate: completionRate, total: all.length, stats, by_agent: byAgent, by_day: byDay }, null, 2));
      return;
    }

    const lines: string[] = [];
    if (opts.markdown) {
      lines.push(`## Todos Report — last ${days} days`);
      lines.push(`*${new Date().toLocaleDateString()}*\n`);
      lines.push(`| Metric | Value |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Active tasks | ${all.length} total (${stats.pending} pending, ${stats.in_progress} active) |`);
      lines.push(`| Changed (${days}d) | ${changed.length} tasks |`);
      lines.push(`| Completed (${days}d) | ${completed.length} (${completionRate}% rate) |`);
      lines.push(`| Failed (${days}d) | ${failed.length} |`);
      if (sparkline) lines.push(`| Activity | \`${sparkline}\` |`);
    } else {
      lines.push(chalk.bold(`todos report — last ${days} day${days !== 1 ? "s" : ""}`));
      lines.push("");
      lines.push(`  Total:      ${chalk.bold(String(all.length))} tasks (${chalk.yellow(String(stats.pending))} pending, ${chalk.blue(String(stats.in_progress))} active)`);
      lines.push(`  Changed:    ${chalk.bold(String(changed.length))} in period`);
      lines.push(`  Completed:  ${chalk.green(String(completed.length))} (${completionRate}% rate)`);
      if (failed.length > 0) lines.push(`  Failed:     ${chalk.red(String(failed.length))}`);
      if (sparkline) lines.push(`  Activity:   ${chalk.dim(sparkline)}`);
      if (Object.keys(byAgent).length > 0) {
        lines.push(`  By agent:   ${Object.entries(byAgent).map(([a, n]) => `${a}=${n}`).join(" ")}`);
      }
      if (stats.in_progress > 0) lines.push(`  Stale risk: check \`todos stale\` for stuck tasks`);
    }

    console.log(lines.join("\n"));
  });

// today
program
  .command("today")
  .description("Show task activity from today")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { getTasksChangedSince } = require("../db/tasks.js") as any;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const tasks: any[] = getTasksChangedSince(start.toISOString(), undefined, db);
    const completed = tasks.filter((t: any) => t.status === "completed");
    const started = tasks.filter((t: any) => t.status === "in_progress");
    const other = tasks.filter((t: any) => t.status !== "completed" && t.status !== "in_progress");
    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify({ date: start.toISOString().slice(0, 10), completed, started, changed: other }));
      return;
    }
    console.log(chalk.bold(`Today — ${start.toISOString().slice(0, 10)}\n`));
    if (completed.length > 0) {
      console.log(chalk.green(`  ✓ Completed (${completed.length}):`));
      for (const t of completed) console.log(`    ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${t.assigned_to ? chalk.dim(` — ${t.assigned_to}`) : ""}`);
    }
    if (started.length > 0) {
      console.log(chalk.blue(`\n  ▶ Started (${started.length}):`));
      for (const t of started) console.log(`    ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${t.assigned_to ? chalk.dim(` — ${t.assigned_to}`) : ""}`);
    }
    if (completed.length === 0 && started.length === 0) console.log(chalk.dim("  No activity today."));
  });

// yesterday
program
  .command("yesterday")
  .description("Show task activity from yesterday")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { getTasksChangedSince } = require("../db/tasks.js") as any;
    const start = new Date(); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setHours(23, 59, 59, 999);
    const allChanged: any[] = getTasksChangedSince(start.toISOString(), undefined, db);
    const tasks = allChanged.filter((t: any) => t.updated_at <= end.toISOString());
    const completed = tasks.filter((t: any) => t.status === "completed");
    const started = tasks.filter((t: any) => t.status === "in_progress");
    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify({ date: start.toISOString().slice(0, 10), completed, started }));
      return;
    }
    console.log(chalk.bold(`Yesterday — ${start.toISOString().slice(0, 10)}\n`));
    if (completed.length > 0) {
      console.log(chalk.green(`  ✓ Completed (${completed.length}):`));
      for (const t of completed) console.log(`    ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${t.assigned_to ? chalk.dim(` — ${t.assigned_to}`) : ""}`);
    }
    if (started.length > 0) {
      console.log(chalk.blue(`\n  ▶ Started (${started.length}):`));
      for (const t of started) console.log(`    ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}`);
    }
    if (completed.length === 0 && started.length === 0) console.log(chalk.dim("  No activity yesterday."));
  });

// mine
program
  .command("mine")
  .description("Show tasks assigned to you, grouped by status")
  .argument("<agent>", "Agent name or ID")
  .option("--json", "Output as JSON")
  .action(async (agent: string, opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { listTasks } = require("../db/tasks.js") as any;
    const projectId = autoProject(globalOpts) || undefined;
    const filter: any = { assigned_to: agent };
    if (projectId) filter.project_id = projectId;
    const tasks: any[] = listTasks(filter, db);
    // Also check agent_id for tasks created by this agent
    const filterByAgent: any = { agent_id: agent };
    if (projectId) filterByAgent.project_id = projectId;
    const agentTasks: any[] = listTasks(filterByAgent, db);
    // Merge, dedupe by id
    const seen = new Set(tasks.map((t: any) => t.id));
    for (const t of agentTasks) {
      if (!seen.has(t.id)) { tasks.push(t); seen.add(t.id); }
    }
    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify(tasks));
      return;
    }
    const groups: Record<string, any[]> = {};
    for (const t of tasks) {
      const s = t.status || "unknown";
      if (!groups[s]) groups[s] = [];
      groups[s].push(t);
    }
    const statusOrder = ["in_progress", "pending", "blocked", "completed", "failed", "cancelled"];
    const statusIcons: Record<string, string> = { in_progress: "▶", pending: "○", blocked: "⊘", completed: "✓", failed: "✗", cancelled: "—" };
    const statusColors: Record<string, (s: string) => string> = { in_progress: chalk.blue, pending: chalk.white, blocked: chalk.red, completed: chalk.green, failed: chalk.red, cancelled: chalk.dim };
    console.log(chalk.bold(`Tasks for ${agent} (${tasks.length} total):\n`));
    for (const status of statusOrder) {
      const group = groups[status];
      if (!group || group.length === 0) continue;
      const color = statusColors[status] || chalk.white;
      const icon = statusIcons[status] || "?";
      console.log(color(`  ${icon} ${status.replace("_", " ")} (${group.length}):`));
      for (const t of group) {
        const priority = t.priority === "critical" || t.priority === "high" ? chalk.red(` [${t.priority}]`) : "";
        console.log(`    ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${priority}`);
      }
    }
    if (tasks.length === 0) console.log(chalk.dim(`  No tasks assigned to ${agent}.`));
  });

// blocked
program
  .command("blocked")
  .description("Show tasks blocked by incomplete dependencies")
  .option("--json", "Output as JSON")
  .option("--project <id>", "Filter to project")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { listTasks, getBlockingDeps } = require("../db/tasks.js") as any;
    const projectId = autoProject(globalOpts) || opts.project || undefined;
    const filter: any = { status: "pending" as const };
    if (projectId) filter.project_id = projectId;
    const allPending: any[] = listTasks(filter, db);
    const blockedTasks: { task: any; blockers: any[] }[] = [];
    for (const t of allPending) {
      const blockers = getBlockingDeps(t.id, db);
      if (blockers.length > 0) blockedTasks.push({ task: t, blockers });
    }
    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify(blockedTasks.map(b => ({ ...b.task, blocked_by: b.blockers.map((bl: any) => ({ id: bl.id, short_id: bl.short_id, title: bl.title, status: bl.status })) }))));
      return;
    }
    if (blockedTasks.length === 0) {
      console.log(chalk.green("  No blocked tasks!"));
      return;
    }
    console.log(chalk.bold(`Blocked (${blockedTasks.length}):\n`));
    for (const { task, blockers } of blockedTasks) {
      console.log(`  ${chalk.cyan(task.short_id || task.id.slice(0, 8))} ${task.title}`);
      for (const bl of blockers) {
        console.log(`    ${chalk.red("⊘")} ${chalk.dim(bl.short_id || bl.id.slice(0, 8))} ${chalk.dim(bl.title)} ${chalk.yellow(`[${bl.status}]`)}`);
      }
    }
  });

// overdue
program
  .command("overdue")
  .description("Show tasks past their due date")
  .option("--json", "Output as JSON")
  .option("--project <id>", "Filter to project")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const projectId = autoProject(globalOpts) || opts.project || undefined;
    const { getOverdueTasks } = require("../db/tasks.js") as any;
    const tasks: any[] = getOverdueTasks(projectId);
    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify(tasks));
      return;
    }
    if (tasks.length === 0) {
      console.log(chalk.green("  No overdue tasks!"));
      return;
    }
    console.log(chalk.bold.red(`Overdue (${tasks.length}):\n`));
    for (const t of tasks) {
      const dueDate = t.due_at!.slice(0, 10);
      const daysOverdue = Math.floor((Date.now() - new Date(t.due_at!).getTime()) / 86400000);
      const urgency = daysOverdue > 7 ? chalk.bgRed.white(` ${daysOverdue}d `) : chalk.red(`${daysOverdue}d`);
      console.log(`  ${urgency} ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${t.assigned_to ? chalk.dim(` — ${t.assigned_to}`) : ""} ${chalk.dim(`(due ${dueDate})`)}`);
    }
  });

// week
program
  .command("week")
  .description("Show task activity from the past 7 days")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { getTasksChangedSince } = require("../db/tasks.js") as any;
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    const tasks: any[] = getTasksChangedSince(start.toISOString(), undefined, db);

    // Group by day
    const days: Record<string, { completed: any[]; started: any[]; other: any[] }> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days[d.toISOString().slice(0, 10)] = { completed: [], started: [], other: [] };
    }
    for (const t of tasks) {
      const day = (t.updated_at || t.created_at).slice(0, 10);
      if (!days[day]) days[day] = { completed: [], started: [], other: [] };
      if (t.status === "completed") days[day].completed.push(t);
      else if (t.status === "in_progress") days[day].started.push(t);
      else days[day].other.push(t);
    }

    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify({ from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), days }));
      return;
    }

    const totalCompleted = tasks.filter((t: any) => t.status === "completed").length;
    const totalStarted = tasks.filter((t: any) => t.status === "in_progress").length;
    console.log(chalk.bold(`Week — ${start.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}`));
    console.log(chalk.dim(`  ${totalCompleted} completed, ${totalStarted} in progress, ${tasks.length} total changes\n`));

    const sortedDays = Object.keys(days).sort().reverse();
    for (const day of sortedDays) {
      const dayData = days[day];
      if (!dayData) continue;
      const { completed, started } = dayData;
      if (completed.length === 0 && started.length === 0) continue;
      const weekday = new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
      console.log(chalk.bold(`  ${weekday} ${day}`));
      for (const t of completed) console.log(`    ${chalk.green("✓")} ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${t.assigned_to ? chalk.dim(` — ${t.assigned_to}`) : ""}`);
      for (const t of started) console.log(`    ${chalk.blue("▶")} ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${t.assigned_to ? chalk.dim(` — ${t.assigned_to}`) : ""}`);
    }
    if (tasks.length === 0) console.log(chalk.dim("  No activity this week."));
  });

// burndown
program
  .command("burndown")
  .description("Show task completion velocity over the past 7 days")
  .option("--days <n>", "Number of days", "7")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { getRecentActivity } = require("../db/audit.js") as any;
    const numDays = parseInt(opts.days, 10);
    const entries: any[] = getRecentActivity(5000, db);
    const now = new Date();
    const dayStats: { date: string; completed: number; created: number; failed: number }[] = [];
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayEntries = entries.filter((e: any) => e.created_at.slice(0, 10) === dateStr);
      dayStats.push({
        date: dateStr,
        completed: dayEntries.filter((e: any) => e.action === "complete").length,
        created: dayEntries.filter((e: any) => e.action === "create").length,
        failed: dayEntries.filter((e: any) => e.action === "fail").length,
      });
    }
    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify(dayStats));
      return;
    }
    const maxVal = Math.max(...dayStats.map(d => Math.max(d.completed, d.created)), 1);
    const barWidth = 30;
    console.log(chalk.bold("Burndown (last " + numDays + " days):\n"));
    console.log(chalk.dim("  Date        Done  New   Failed  Chart"));
    for (const day of dayStats) {
      const weekday = new Date(day.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
      const completedBar = chalk.green("█".repeat(Math.round((day.completed / maxVal) * barWidth)));
      const createdBar = chalk.blue("░".repeat(Math.round((day.created / maxVal) * barWidth)));
      const failed = day.failed > 0 ? chalk.red(String(day.failed).padStart(4)) : chalk.dim("   0");
      console.log(`  ${weekday} ${day.date.slice(5)}  ${chalk.green(String(day.completed).padStart(4))}  ${chalk.blue(String(day.created).padStart(4))}   ${failed}  ${completedBar}${createdBar}`);
    }
    const totalCompleted = dayStats.reduce((s, d) => s + d.completed, 0);
    const totalCreated = dayStats.reduce((s, d) => s + d.created, 0);
    const velocity = (totalCompleted / numDays).toFixed(1);
    console.log(chalk.dim(`\n  Velocity: ${velocity}/day · ${totalCompleted} done · ${totalCreated} created`));
  });

// log
program
  .command("log")
  .description("Show recent task activity log (git-log style)")
  .option("--limit <n>", "Number of entries", "30")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { getRecentActivity } = require("../db/audit.js") as any;
    const entries: any[] = getRecentActivity(parseInt(opts.limit, 10), db);
    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify(entries));
      return;
    }
    if (entries.length === 0) {
      console.log(chalk.dim("  No activity yet."));
      return;
    }
    const actionIcons: Record<string, string> = {
      create: chalk.green("+"), start: chalk.blue("▶"), complete: chalk.green("✓"),
      fail: chalk.red("✗"), update: chalk.yellow("~"), approve: chalk.green("★"),
      lock: chalk.dim("🔒"), unlock: chalk.dim("🔓"),
    };
    let lastDate = "";
    for (const e of entries) {
      const date = e.created_at.slice(0, 10);
      const time = e.created_at.slice(11, 16);
      if (date !== lastDate) {
        console.log(chalk.bold(`\n  ${date}`));
        lastDate = date;
      }
      const icon = actionIcons[e.action] || chalk.dim("·");
      const agent = e.agent_id ? chalk.dim(` (${e.agent_id})`) : "";
      const taskRef = chalk.cyan(e.task_id.slice(0, 8));
      let detail = "";
      if (e.field && e.old_value && e.new_value) {
        detail = chalk.dim(` ${e.field}: ${e.old_value} → ${e.new_value}`);
      } else if (e.field && e.new_value) {
        detail = chalk.dim(` ${e.field}: ${e.new_value}`);
      }
      console.log(`  ${chalk.dim(time)} ${icon} ${e.action.padEnd(8)} ${taskRef}${detail}${agent}`);
    }
  });

// ready
program
  .command("ready")
  .description("Show all tasks ready to be claimed (pending, unblocked, unlocked)")
  .option("--json", "Output as JSON")
  .option("--project <id>", "Filter to project")
  .option("--limit <n>", "Max tasks to show", "20")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { listTasks, getBlockingDeps } = require("../db/tasks.js") as any;
    const { isLockExpired } = require("../db/database.js");
    const projectId = autoProject(globalOpts) || opts.project || undefined;
    const filter: any = { status: "pending" };
    if (projectId) filter.project_id = projectId;
    const pending: any[] = listTasks(filter, db);
    const ready = pending.filter((t: any) => {
      // Not locked (or lock expired)
      if (t.locked_by && !isLockExpired(t.locked_at)) return false;
      // No unmet dependencies
      const blockers = getBlockingDeps(t.id, db);
      return blockers.length === 0;
    });
    const limited = ready.slice(0, parseInt(opts.limit, 10));
    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify(limited));
      return;
    }
    if (limited.length === 0) {
      console.log(chalk.dim("  No tasks ready to claim."));
      return;
    }
    console.log(chalk.bold(`Ready to claim (${ready.length}${ready.length > limited.length ? `, showing ${limited.length}` : ""}):\n`));
    for (const t of limited) {
      const pri = t.priority === "critical" ? chalk.bgRed.white(" CRIT ") : t.priority === "high" ? chalk.red("[high]") : t.priority === "medium" ? chalk.yellow("[med]") : "";
      const due = t.due_at ? chalk.dim(` due ${t.due_at.slice(0, 10)}`) : "";
      console.log(`  ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title} ${pri}${due}`);
    }
  });

// sprint
program
  .command("sprint")
  .description("Sprint dashboard: in-progress, next up, blockers, and overdue")
  .option("--json", "Output as JSON")
  .option("--project <id>", "Filter to project")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { listTasks, getBlockingDeps } = require("../db/tasks.js") as any;
    const projectId = autoProject(globalOpts) || opts.project || undefined;
    const baseFilter: any = {};
    if (projectId) baseFilter.project_id = projectId;

    const inProgress: any[] = listTasks({ ...baseFilter, status: "in_progress" }, db);
    const pending: any[] = listTasks({ ...baseFilter, status: "pending" }, db);
    const nowStr = new Date().toISOString();

    // Find blocked tasks
    const blocked: { task: any; blockers: any[] }[] = [];
    for (const t of pending) {
      const blockers = getBlockingDeps(t.id, db);
      if (blockers.length > 0) blocked.push({ task: t, blockers });
    }

    // Find overdue
    const overdue = [...inProgress, ...pending].filter((t: any) => t.due_at && t.due_at < nowStr);

    // Next up: top 5 unblocked pending by priority
    const blockedIds = new Set(blocked.map(b => b.task.id));
    const nextUp = pending.filter((t: any) => !blockedIds.has(t.id)).slice(0, 5);

    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify({ in_progress: inProgress, next_up: nextUp, blocked, overdue }));
      return;
    }

    console.log(chalk.bold("Sprint Dashboard\n"));

    // In progress
    console.log(chalk.blue(`  ▶ In Progress (${inProgress.length}):`));
    if (inProgress.length === 0) console.log(chalk.dim("    (none)"));
    for (const t of inProgress) {
      const agent = t.assigned_to ? chalk.dim(` — ${t.assigned_to}`) : "";
      console.log(`    ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${agent}`);
    }

    // Next up
    console.log(chalk.white(`\n  ○ Next Up (${nextUp.length}):`));
    if (nextUp.length === 0) console.log(chalk.dim("    (none)"));
    for (const t of nextUp) {
      const pri = t.priority === "critical" ? chalk.bgRed.white(" CRIT ") : t.priority === "high" ? chalk.red("[high]") : "";
      console.log(`    ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title} ${pri}`);
    }

    // Blocked
    if (blocked.length > 0) {
      console.log(chalk.red(`\n  ⊘ Blocked (${blocked.length}):`));
      for (const { task, blockers } of blocked) {
        console.log(`    ${chalk.cyan(task.short_id || task.id.slice(0, 8))} ${task.title}`);
        for (const bl of blockers) console.log(`      ${chalk.dim("← " + (bl.short_id || bl.id.slice(0, 8)) + " " + bl.title)} ${chalk.yellow(`[${bl.status}]`)}`);
      }
    }

    // Overdue
    if (overdue.length > 0) {
      console.log(chalk.red(`\n  ⚠ Overdue (${overdue.length}):`));
      for (const t of overdue) {
        const daysOver = Math.floor((Date.now() - new Date(t.due_at).getTime()) / 86400000);
        console.log(`    ${chalk.red(`${daysOver}d`)} ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}`);
      }
    }

    // Summary line
    console.log(chalk.dim(`\n  ${inProgress.length} active · ${pending.length} pending · ${blocked.length} blocked · ${overdue.length} overdue`));
  });

// handoff
program
  .command("handoff")
  .description("Create or view agent session handoffs")
  .option("--create", "Create a new handoff")
  .option("--agent <name>", "Agent name")
  .option("--summary <text>", "Handoff summary")
  .option("--completed <items>", "Comma-separated completed items")
  .option("--in-progress <items>", "Comma-separated in-progress items")
  .option("--blockers <items>", "Comma-separated blockers")
  .option("--next <items>", "Comma-separated next steps")
  .option("--json", "Output as JSON")
  .option("--limit <n>", "Number of handoffs to show", "5")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { createHandoff, listHandoffs } = require("../db/handoffs.js") as any;
    const projectId = autoProject(globalOpts) || undefined;

    if (opts.create || opts.summary) {
      if (!opts.summary) { console.error(chalk.red("  --summary is required for creating a handoff")); process.exit(1); }
      const handoff = createHandoff({
        agent_id: opts.agent || globalOpts.agent || undefined,
        project_id: projectId,
        summary: opts.summary,
        completed: opts.completed ? opts.completed.split(",").map((s: string) => s.trim()) : undefined,
        inProgress: opts.inProgress ? opts.inProgress.split(",").map((s: string) => s.trim()) : undefined,
        blockers: opts.blockers ? opts.blockers.split(",").map((s: string) => s.trim()) : undefined,
        next_steps: opts.next ? opts.next.split(",").map((s: string) => s.trim()) : undefined,
      }, db);
      if (opts.json || globalOpts.json) { console.log(JSON.stringify(handoff)); return; }
      console.log(chalk.green(`  ✓ Handoff created by ${handoff.agent_id || "unknown"}`));
      return;
    }

    // View mode — show recent handoffs
    const handoffs: any[] = listHandoffs(projectId, parseInt(opts.limit, 10), db);
    if (opts.json || globalOpts.json) { console.log(JSON.stringify(handoffs)); return; }
    if (handoffs.length === 0) { console.log(chalk.dim("  No handoffs yet.")); return; }

    for (const h of handoffs) {
      const time = h.created_at.slice(0, 16).replace("T", " ");
      console.log(chalk.bold(`\n  ${time} ${h.agent_id || "unknown"}`));
      console.log(`  ${h.summary}`);
      if (h.completed?.length) {
        console.log(chalk.green(`  ✓ Completed:`));
        for (const c of h.completed) console.log(`    - ${c}`);
      }
      if (h.in_progress?.length) {
        console.log(chalk.blue(`  ▶ In progress:`));
        for (const c of h.in_progress) console.log(`    - ${c}`);
      }
      if (h.blockers?.length) {
        console.log(chalk.red(`  ⊘ Blockers:`));
        for (const c of h.blockers) console.log(`    - ${c}`);
      }
      if (h.next_steps?.length) {
        console.log(chalk.cyan(`  → Next steps:`));
        for (const c of h.next_steps) console.log(`    - ${c}`);
      }
    }
  });

// priorities
program
  .command("priorities")
  .description("Show task counts grouped by priority")
  .option("--json", "Output as JSON")
  .option("--project <id>", "Filter to project")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { countTasks } = require("../db/tasks.js") as any;
    const projectId = autoProject(globalOpts) || opts.project || undefined;
    const base = projectId ? { project_id: projectId } : {};
    const priorities = ["critical", "high", "medium", "low", "none"];
    const counts: Record<string, { total: number; pending: number; in_progress: number; completed: number }> = {};
    for (const p of priorities) {
      counts[p] = {
        total: countTasks({ ...base, priority: p }, db),
        pending: countTasks({ ...base, priority: p, status: "pending" }, db),
        in_progress: countTasks({ ...base, priority: p, status: "in_progress" }, db),
        completed: countTasks({ ...base, priority: p, status: "completed" }, db),
      };
    }
    if (opts.json || globalOpts.json) { console.log(JSON.stringify(counts)); return; }
    console.log(chalk.bold("Priority Breakdown:\n"));
    const priColors: Record<string, (s: string) => string> = { critical: chalk.bgRed.white, high: chalk.red, medium: chalk.yellow, low: chalk.blue, none: chalk.dim };
    for (const p of priorities) {
      const c = counts[p];
      if (!c || c.total === 0) continue;
      const color = priColors[p] || chalk.white;
      const bar = chalk.green("█".repeat(Math.min(c.completed, 30))) + chalk.blue("░".repeat(Math.min(c.in_progress, 10))) + chalk.dim("·".repeat(Math.min(c.pending, 20)));
      console.log(`  ${color(p.padEnd(9))} ${String(c.total).padStart(4)} total  ${chalk.green(String(c.completed).padStart(3))} done  ${chalk.blue(String(c.in_progress).padStart(3))} active  ${chalk.dim(String(c.pending).padStart(3))} pending  ${bar}`);
    }
  });

// context — one-shot session start info
program
  .command("context")
  .description("Session start context: status, latest handoff, next task, overdue")
  .option("--agent <name>", "Agent name for handoff lookup")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const db = getDatabase();
    const { getStatus } = require("../db/tasks.js") as any;
    const { getNextTask, getOverdueTasks } = require("../db/tasks.js") as any;
    const { getLatestHandoff } = require("../db/handoffs.js") as any;
    const projectId = autoProject(globalOpts) || undefined;
    const agentName = opts.agent || globalOpts.agent || undefined;
    const filters = projectId ? { project_id: projectId } : undefined;
    const status = getStatus(filters, agentName);
    const nextTask = getNextTask(agentName, filters, db);
    const overdue = getOverdueTasks(projectId, db);
    const handoff = agentName ? getLatestHandoff(agentName, projectId, db) : getLatestHandoff(undefined, projectId, db);

    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify({ status, next_task: nextTask, overdue_count: overdue.length, latest_handoff: handoff, as_of: new Date().toISOString() }));
      return;
    }

    console.log(chalk.bold("Session Context\n"));
    console.log(`  ${status.pending} pending · ${status.in_progress} active · ${status.completed} done · ${status.total} total`);
    if (status.stale_count > 0) console.log(chalk.yellow(`  ⚠ ${status.stale_count} stale tasks`));
    if (overdue.length > 0) console.log(chalk.red(`  ⚠ ${overdue.length} overdue tasks`));

    if (nextTask) {
      const pri = nextTask.priority === "critical" || nextTask.priority === "high" ? chalk.red(` [${nextTask.priority}]`) : "";
      console.log(chalk.bold(`\n  Next up:`));
      console.log(`    ${chalk.cyan(nextTask.short_id || nextTask.id.slice(0, 8))} ${nextTask.title}${pri}`);
    }

    if (handoff) {
      console.log(chalk.bold(`\n  Last handoff (${handoff.agent_id || "unknown"}, ${handoff.created_at.slice(0, 16).replace("T", " ")}):`));
      console.log(`    ${handoff.summary}`);
      if (handoff.next_steps?.length) {
        for (const s of handoff.next_steps) console.log(`    → ${s}`);
      }
    }

    console.log(chalk.dim(`\n  as_of: ${new Date().toISOString()}`));
  });

// report-failure — create a task from a test/build failure
program
  .command("report-failure")
  .description("Create a task from a test/build/typecheck failure and auto-assign it")
  .requiredOption("--error <message>", "Error message or summary")
  .option("--type <type>", "Failure type: test, build, typecheck, runtime, other", "test")
  .option("--file <path>", "File where failure occurred")
  .option("--stack <trace>", "Stack trace or detailed output")
  .option("--title <title>", "Custom task title (auto-generated if omitted)")
  .option("--priority <p>", "Priority: low, medium, high, critical")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const { createTask } = require("../db/tasks.js") as any;
    const { autoAssignTask } = await import("../lib/auto-assign.js");
    const projectId = autoProject(globalOpts);

    const failureType = opts.type || "test";
    const defaultPriority = (failureType === "build" || failureType === "typecheck") ? "high" : "medium";
    const taskPriority = opts.priority || defaultPriority;

    const autoTitle = opts.title || `${failureType.toUpperCase()} failure${opts.file ? ` in ${(opts.file as string).split("/").pop()}` : ""}: ${(opts.error as string).slice(0, 60)}`;
    const descParts = [
      `**Failure type:** ${failureType}`,
      opts.file ? `**File:** ${opts.file}` : null,
      `**Error:**\n\`\`\`\n${(opts.error as string).slice(0, 500)}\n\`\`\``,
      opts.stack ? `**Stack trace:**\n\`\`\`\n${(opts.stack as string).slice(0, 1500)}\n\`\`\`` : null,
    ].filter(Boolean).join("\n\n");

    const task = createTask({
      title: autoTitle,
      description: descParts,
      priority: taskPriority,
      project_id: projectId || undefined,
      tags: ["failure", failureType, "auto-created"],
      status: "pending",
    });

    const assignResult = await autoAssignTask(task.id);

    if (opts.json || globalOpts.json) {
      console.log(JSON.stringify({ task_id: task.id, short_id: task.short_id, title: task.title, assigned_to: assignResult.agent_name, method: assignResult.method }));
      return;
    }

    console.log(chalk.green(`✓ Created task ${task.short_id || task.id.slice(0, 8)}: ${task.title}`));
    if (assignResult.agent_name) {
      console.log(chalk.cyan(`  Assigned to: ${assignResult.agent_name} (via ${assignResult.method})`));
      if (assignResult.reason) console.log(chalk.dim(`  Reason: ${assignResult.reason}`));
    }
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

// ── brains subcommand ────────────────────────────────────────────────────────
import { makeBrainsCommand } from "./brains.js";
program.addCommand(makeBrainsCommand());

// ── db subcommand ────────────────────────────────────────────────────────────
const dbCmd = program
  .command("db")
  .description("Database management commands");

dbCmd
  .command("migrate-pg")
  .description("Apply PostgreSQL migrations to the configured RDS instance")
  .option("--connection-string <url>", "PostgreSQL connection string (overrides cloud config)")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const useJson = opts.json || globalOpts.json;

    let connStr: string;
    if (opts.connectionString) {
      connStr = opts.connectionString;
    } else {
      try {
        const { getConnectionString } = await import("@hasna/cloud");
        connStr = getConnectionString("todos");
      } catch (e) {
        const msg = "Cloud RDS not configured. Use --connection-string or run `cloud setup`.";
        if (useJson) {
          console.log(JSON.stringify({ error: msg }));
        } else {
          console.error(chalk.red(msg));
        }
        process.exit(1);
      }
    }

    try {
      const { applyPgMigrations } = await import("../db/pg-migrate.js");
      const result = await applyPgMigrations(connStr);

      if (useJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.applied.length > 0) {
        console.log(chalk.green(`Applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`));
      }
      if (result.alreadyApplied.length > 0) {
        console.log(chalk.dim(`Already applied: ${result.alreadyApplied.length} migration(s)`));
      }
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.error(chalk.red(`  Error: ${err}`));
        }
        process.exit(1);
      }
      if (result.applied.length === 0 && result.errors.length === 0) {
        console.log(chalk.dim("Schema is up to date."));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (useJson) {
        console.log(JSON.stringify({ error: msg }));
      } else {
        console.error(chalk.red(`Migration failed: ${msg}`));
      }
      process.exit(1);
    }
  });

// ── dispatch subcommand ───────────────────────────────────────────────────────
const dispatchCmd = program
  .command("dispatch")
  .description("Send tasks or task lists to a tmux window")
  .argument("<target>", "tmux target: window, session:window, or session:window.pane")
  .option("--tasks <ids>", "Comma-separated task IDs to dispatch")
  .option("--list <id>", "Task list ID or slug to dispatch")
  .option("--filter-status <statuses>", "Comma-separated task statuses to include (default: pending)", "pending")
  .option("--delay <ms>", "Delay in ms between message and Enter (auto-calculated if omitted)", parseInt)
  .option("--at <datetime>", "ISO datetime to schedule the dispatch")
  .option("--multiple <targets>", "Comma-separated list of additional tmux targets (fan-out)")
  .option("--stagger <ms>", "Delay between targets when using --multiple (default: 500ms)", parseInt)
  .option("--dry-run", "Preview the formatted message without sending")
  .action(async (target: string, opts) => {
    const globalOpts = program.opts();
    const useJson = globalOpts.json;
    const db = getDatabase();

    try {
      let tasks: Task[] = [];
      let listName: string | undefined;

      if (opts.tasks) {
        const ids = (opts.tasks as string).split(",").map((s: string) => s.trim());
        const resolvedIds = ids.map((id: string) => {
          const resolved = resolvePartialId(db, "tasks", id);
          if (!resolved) throw new Error(`Task not found: ${id}`);
          return resolved;
        });
        tasks = listTasks({ ids: resolvedIds } as any, db);
      } else if (opts.list) {
        const resolvedListId = resolvePartialId(db, "task_lists", opts.list);
        if (!resolvedListId) throw new Error(`Task list not found: ${opts.list}`);
        const taskList = getTaskList(resolvedListId, db);
        listName = taskList.name;
        const statuses = (opts.filterStatus as string).split(",").map((s: string) => s.trim());
        tasks = listTasks({ task_list_id: resolvedListId, status: statuses } as any, db);
      } else {
        console.error(chalk.red("Error: provide --tasks <ids> or --list <id>"));
        process.exit(1);
      }

      const message = formatDispatchMessage(tasks, { listName });
      const delayMs = opts.delay ?? calculateDelay(message);

      if (opts.dryRun) {
        console.log(chalk.dim(`[dry-run] target=${target} delay=${delayMs}ms tasks=${tasks.length}`));
        console.log(message);
        return;
      }

      const targets = opts.multiple
        ? [target, ...(opts.multiple as string).split(",").map((s: string) => s.trim())]
        : [target];

      if (targets.length > 1) {
        const dispatches = await dispatchToMultiple(
          {
            targets,
            task_ids: tasks.map((t) => t.id),
            message,
            delay_ms: delayMs,
            stagger_ms: opts.stagger ?? 500,
            scheduled_at: opts.at,
          },
          {},
          db,
        );
        if (useJson) {
          console.log(JSON.stringify(dispatches, null, 2));
        } else {
          for (const d of dispatches) {
            console.log(chalk.green(`✓`) + ` ${d.target_window} [${d.id.slice(0, 8)}]`);
          }
        }
      } else {
        const dispatch = createDispatch({
          target_window: target,
          task_ids: tasks.map((t) => t.id),
          message,
          delay_ms: delayMs,
          scheduled_at: opts.at,
        }, db);

        if (!opts.at) {
          await executeDispatch(dispatch, {}, db);
          if (useJson) {
            console.log(JSON.stringify({ id: dispatch.id, status: "sent" }));
          } else {
            console.log(chalk.green(`✓`) + ` Dispatched to ${target} (${tasks.length} task${tasks.length !== 1 ? "s" : ""})`);
          }
        } else {
          if (useJson) {
            console.log(JSON.stringify({ id: dispatch.id, status: "scheduled", scheduled_at: opts.at }));
          } else {
            console.log(chalk.yellow(`Scheduled`) + ` dispatch ${dispatch.id.slice(0, 8)} → ${target} at ${opts.at}`);
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (useJson) {
        console.log(JSON.stringify({ error: msg }));
      } else {
        console.error(chalk.red(`Error: ${msg}`));
      }
      process.exit(1);
    }
  });

// todos dispatch run
dispatchCmd
  .command("run")
  .description("Fire all pending dispatches that are due now")
  .option("--all", "Ignore scheduled_at and fire all pending immediately")
  .option("--dry-run", "Preview without sending")
  .action(async (opts) => {
    try {
      const count = await runDueDispatches({ dryRun: opts.dryRun });
      console.log(chalk.green(`Fired ${count} dispatch(es).`));
    } catch (e) {
      console.error(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`));
      process.exit(1);
    }
  });

// ── dispatches list ────────────────────────────────────────────────────────────
program
  .command("dispatches")
  .description("List dispatch history")
  .option("--status <status>", "Filter by status: pending, sent, failed, cancelled")
  .option("--limit <n>", "Max results (default: 20)", parseInt)
  .option("--cancel <id>", "Cancel a pending dispatch by ID")
  .action((opts) => {
    const globalOpts = program.opts();
    const useJson = globalOpts.json;

    if (opts.cancel) {
      try {
        const dispatch = cancelDispatch(opts.cancel);
        if (useJson) {
          console.log(JSON.stringify(dispatch, null, 2));
        } else {
          console.log(chalk.yellow(`Cancelled`) + ` dispatch ${dispatch.id.slice(0, 8)} → ${dispatch.target_window}`);
        }
        return;
      } catch (e) {
        console.error(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
      }
    }

    const statuses = opts.status ? opts.status.split(",").map((s: string) => s.trim()) : undefined;
    const dispatches = listDispatches({ status: statuses as any, limit: opts.limit ?? 20 });

    if (useJson) {
      console.log(JSON.stringify(dispatches, null, 2));
      return;
    }

    if (dispatches.length === 0) {
      console.log(chalk.dim("No dispatches found."));
      return;
    }

    const STATUS_COLOR: Record<string, (s: string) => string> = {
      pending: chalk.yellow,
      sent: chalk.green,
      failed: chalk.red,
      cancelled: chalk.dim,
    };

    for (const d of dispatches) {
      const colorFn = STATUS_COLOR[d.status] ?? chalk.white;
      const taskCount = d.task_ids.length || (d.task_list_id ? "(list)" : "0");
      const timing = d.sent_at
        ? `sent ${d.sent_at}`
        : d.scheduled_at
          ? `scheduled ${d.scheduled_at}`
          : `created ${d.created_at}`;
      const err = d.error ? chalk.red(` err=${d.error.slice(0, 50)}`) : "";
      console.log(
        `${colorFn(d.status.padEnd(9))} ${d.id.slice(0, 8)} → ${chalk.bold(d.target_window)} tasks=${taskCount} ${chalk.dim(timing)}${err}`,
      );
    }
  });

program.parse();
