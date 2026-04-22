import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import { getProject } from "../../db/projects.js";
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
} from "../../db/tasks.js";
import type { TaskPriority, TaskStatus } from "../../types/index.js";
import {
  formatTaskLine,
  resolveTaskId,
  normalizeStatus,
  autoProject,
  handleError,
  output,
  statusColors,
  priorityColors,
} from "../helpers.js";

/** Resolve a project by ID or name substring. */
function resolveProjectIdOrSlug(input: string): string {
  const db = getDatabase();
  // Try exact ID match first
  const byId = getProject(input, db);
  if (byId) return byId.id;
  // Fall back to name substring match
  const row = db.query("SELECT id FROM projects WHERE name LIKE ? LIMIT 1").get(`%${input}%`) as { id: string } | undefined;
  if (row) return row.id;
  console.error(chalk.red(`Project not found: ${input}`));
  process.exit(1);
}

export function registerTaskCommands(program: Command) {
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
    .option("--project <id>", "Assign to project by ID or slug (overrides auto-detect)")
    .action((title: string, opts) => {
      const globalOpts = program.opts();
      const projectId = opts.project
        ? resolveProjectIdOrSlug(opts.project)
        : autoProject(globalOpts);
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
        status: opts.status ? normalizeStatus(opts.status) as TaskStatus : undefined,
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
      const hasAssignedFilter = Boolean(opts.assigned || opts.agentName);
      const hasExplicitProjectFilter = Boolean(globalOpts.project || opts.projectName);
      const allowedSortFields = new Set(["updated", "created", "priority", "status"]);
      if (opts.sort && !allowedSortFields.has(opts.sort)) {
        console.error(chalk.red(`Invalid --sort value: ${opts.sort}. Allowed values: updated, created, priority, status.`));
        process.exit(1);
      }
      const allowedFormats = new Set(["table", "compact", "csv", "json"]);
      if (opts.format && !allowedFormats.has(opts.format)) {
        console.error(chalk.red(`Invalid --format value: ${opts.format}. Allowed values: table, compact, csv, json.`));
        process.exit(1);
      }

      const filter: Record<string, unknown> = {};
      if (projectId && !(hasAssignedFilter && !hasExplicitProjectFilter)) {
        filter["project_id"] = projectId;
      }
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
          ? opts.status.split(",").map((s: string) => normalizeStatus(s.trim()))
          : normalizeStatus(opts.status);
      } else if (!opts.all) {
        filter["status"] = ["pending", "in_progress"];
      }
      if (opts.priority) filter["priority"] = opts.priority;
      if (opts.assigned) filter["assigned_to"] = opts.assigned;
      if (opts.tags) filter["tags"] = opts.tags.split(",").map((t: string) => t.trim());
      if (opts.projectName) {
        const { listProjects } = require("../../db/projects.js") as any;
        const projects = listProjects();
        const match = projects.find((p: any) => p.name.toLowerCase().includes(opts.projectName.toLowerCase()));
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
      if (opts.limit !== undefined) {
        const parsedLimit = Number.parseInt(String(opts.limit), 10);
        if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
          console.error(chalk.red(`Invalid --limit value: ${opts.limit}. Must be a positive integer.`));
          process.exit(1);
        }
        filter["limit"] = parsedLimit;
      }

      let tasks = listTasks(filter as any);
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
        tasks.sort((a: any, b: any) => {
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
        const rows = tasks.map((t: any) => [
          t.id, t.short_id || "", t.title.replace(/,/g, ";"), t.status, t.priority, t.assigned_to || "", t.updated_at,
        ].join(","));
        console.log([headers, ...rows].join("\n"));
        return;
      }

      if (fmt === "compact") {
        for (const t of tasks) {
          const id = t.short_id || t.id.slice(0, 8);
          const assigned = t.assigned_to ? ` ${t.assigned_to}` : "";
          process.stdout.write(`${id} ${t.status} ${t.priority} ${t.title}${assigned}\n`);
        }
        return;
      }

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

  // inspect
  program
    .command("inspect [id]")
    .description("Full orientation for a task — details, description, dependencies, blocker, files, commits, comments. If no ID given, shows current in-progress task for --agent.")
    .action(async (id?: string) => {
      const globalOpts = program.opts();
      let resolvedId = id ? resolveTaskId(id) : null;

      if (!resolvedId && globalOpts.agent) {
        const { listTasks: lt } = await import("../../db/tasks.js");
        const active = lt({ status: "in_progress", assigned_to: globalOpts.agent! });
        if (active.length > 0) resolvedId = active[0]!.id;
      }
      if (!resolvedId) { console.error(chalk.red("No task ID given and no active task found. Pass an ID or use --agent.")); process.exit(1); }

      const task = getTaskWithRelations(resolvedId);
      if (!task) { console.error(chalk.red(`Task not found: ${id || resolvedId}`)); process.exit(1); }

      if (globalOpts.json) {
        const { listTaskFiles } = await import("../../db/task-files.js");
        const { getTaskCommits } = await import("../../db/task-commits.js");
        try { (task as any).files = listTaskFiles(task.id); } catch (e) { console.error(chalk.dim(`Warning: could not load task files: ${e instanceof Error ? e.message : String(e)}`)); }
        try { (task as any).commits = getTaskCommits(task.id); } catch (e) { console.error(chalk.dim(`Warning: could not load task commits: ${e instanceof Error ? e.message : String(e)}`)); }
        output(task, true);
        return;
      }

      const sid = task.short_id || task.id.slice(0, 8);
      const statusColor = statusColors[task.status] || chalk.white;
      const prioColor = priorityColors[task.priority] || chalk.white;
      console.log(chalk.bold(`\n${chalk.cyan(sid)} ${statusColor(task.status)} ${prioColor(task.priority)} ${task.title}\n`));

      if (task.description) {
        console.log(chalk.dim("Description:"));
        console.log(`  ${task.description}\n`);
      }

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

      if (task.blocked_by.length > 0) {
        console.log(chalk.bold(`\n  Blocks (${task.blocked_by.length}):`));
        for (const b of task.blocked_by) console.log(`    ${formatTaskLine(b)}`);
      }

      if (task.subtasks.length > 0) {
        console.log(chalk.bold(`\n  Subtasks (${task.subtasks.length}):`));
        for (const st of task.subtasks) console.log(`    ${formatTaskLine(st)}`);
      }

      // Files
      try {
        const { listTaskFiles } = await import("../../db/task-files.js");
        const files = listTaskFiles(task.id);
        if (files.length > 0) {
          console.log(chalk.bold(`\n  Files (${files.length}):`));
          for (const f of files) console.log(`    ${chalk.dim(f.status || "file")} ${f.path}`);
        }
      } catch (e) {
        console.error(chalk.dim(`Warning: could not load task files: ${e instanceof Error ? e.message : String(e)}`));
      }

      // Commits
      try {
        const { getTaskCommits } = await import("../../db/task-commits.js");
        const commits = getTaskCommits(task.id);
        if (commits.length > 0) {
          console.log(chalk.bold(`\n  Commits (${commits.length}):`));
          for (const c of commits) console.log(`    ${chalk.yellow(c.sha.slice(0, 7))} ${c.message || ""}`);
        }
      } catch (e) {
        console.error(chalk.dim(`Warning: could not load task commits: ${e instanceof Error ? e.message : String(e)}`));
      }

      if (task.comments.length > 0) {
        console.log(chalk.bold(`\n  Comments (${task.comments.length}):`));
        for (const c of task.comments) {
          const agent = c.agent_id ? chalk.cyan(`[${c.agent_id}] `) : "";
          console.log(`    ${agent}${chalk.dim(c.created_at)}: ${c.content}`);
        }
      }

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
    .action(async (id: string) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(id);
      const { getTaskHistory } = await import("../../db/audit.js");
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
          status: opts.status ? normalizeStatus(opts.status) as TaskStatus : undefined,
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

  // remove
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
}
