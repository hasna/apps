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
import { getAgentTaskListId, loadConfig } from "../lib/config.js";
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
  .action((id: string, opts: { attachIds?: string; filesChanged?: string; testResults?: string; commitHash?: string; notes?: string }) => {
    const globalOpts = program.opts();
    const resolvedId = resolveTaskId(id);
    const attachmentIds = opts.attachIds ? opts.attachIds.split(",").map((s) => s.trim()) : undefined;
    const filesChanged = opts.filesChanged ? opts.filesChanged.split(",").map((s) => s.trim()) : undefined;
    const evidence = (attachmentIds || filesChanged || opts.testResults || opts.commitHash || opts.notes)
      ? { attachment_ids: attachmentIds, files_changed: filesChanged, test_results: opts.testResults, commit_hash: opts.commitHash, notes: opts.notes }
      : undefined;
    let task;
    try {
      task = completeTask(resolvedId, globalOpts.agent, undefined, evidence);
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
  .option("--use <id>", "Create a task from a template")
  .action((opts) => {
    const globalOpts = program.opts();
    const { createTemplate, listTemplates, deleteTemplate, taskFromTemplate } = require("../db/templates.js");

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
      console.log(`  ${chalk.dim(t.id.slice(0, 8))} ${chalk.bold(t.name)} ${chalk.cyan(`"${t.title_pattern}"`)} ${chalk.yellow(t.priority)}`);
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
