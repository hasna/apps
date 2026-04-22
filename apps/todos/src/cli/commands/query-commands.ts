import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import {
  listTasks,
  updateTask,
  getNextTask,
  claimNextTask,
  getStatus,
  failTask,
  getActiveWork,
  getStaleTasks,
  redistributeStaleTasks,
  getTask,
} from "../../db/tasks.js";
import { getRecap } from "../../db/audit.js";
import { createHandoff, listHandoffs, getLatestHandoff } from "../../db/handoffs.js";
import { isValidRecurrenceRule } from "../../lib/recurrence.js";
import { autoProject, handleError, output, formatTaskLine, resolveTaskId } from "../helpers.js";

export function registerQueryCommands(program: Command) {
  // next
  program
    .command("next")
    .description("Show the best pending task to work on next")
    .option("--agent <id>", "Prefer tasks assigned to this agent")
    .option("--project <id>", "Filter to project")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const filters: Record<string, string> = {};
      const projectInput = opts.project || globalOpts.project;
      if (projectInput) {
        const pid = autoProject({ project: projectInput })
          || resolvePartialId(db, "projects", projectInput)
          || (db.query("SELECT id FROM projects WHERE path = ? OR name = ? OR task_list_id = ?").get(projectInput, projectInput, projectInput) as any)?.id;
        if (pid) filters.project_id = pid;
      }
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
    .option("-j, --json", "Output as JSON")
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
    .action(async (agent, opts) => {
      const globalOpts = program.opts();
      const { stealTask } = await import("../../db/tasks.js");
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
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const db = getDatabase();
      const filters: Record<string, string> = {};
      if (opts.project) filters.project_id = opts.project;
      const s = getStatus(Object.keys(filters).length ? filters : undefined, opts.agent, undefined, db);
      if (opts.json) { console.log(JSON.stringify(s, null, 2)); return; }
      console.log(`Tasks: ${chalk.yellow(String(s.pending))} pending | ${chalk.blue(String(s.in_progress))} active | ${chalk.green(String(s.completed))} done | ${s.total} total`);
      if (s.stale_count > 0) console.log(chalk.red(`${s.stale_count} stale tasks (stuck in_progress)`));
      if (s.overdue_recurring > 0) console.log(chalk.yellow(`${s.overdue_recurring} overdue recurring`));
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
    .action(async (agent: string, opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const projectId = opts.project ? resolvePartialId(db, "tasks", opts.project) ?? autoProject(globalOpts) : autoProject(globalOpts) ?? undefined;
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
    .action(async (id: string, opts) => {
      const globalOpts = program.opts();
      const resolvedId = resolveTaskId(id);
      const db = getDatabase();
      const { setTaskPriority } = await import("../../db/tasks.js");
      try {
        const updated = setTaskPriority(resolvedId, "critical", undefined, db);
        if (opts.json || globalOpts.json) { console.log(JSON.stringify(updated)); return; }
        console.log(chalk.red(`Pinned (critical): ${formatTaskLine(updated)}`));
      } catch { handleError(new Error("Failed to pin")); }
    });

  // summary
  program
    .command("summary")
    .description("Generate a markdown summary of recent task activity")
    .option("--days <n>", "Days of history to include", "7")
    .option("--project <id>", "Filter to project")
    .option("--agent <id>", "Filter to agent")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const days = parseInt(opts.days, 10);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const projectId = opts.project || autoProject(globalOpts);

      const filter: Record<string, unknown> = {};
      if (projectId) filter.project_id = projectId;
      if (opts.agent) filter.assigned_to = opts.agent;

      const { getTasksChangedSince } = await import("../../db/tasks.js");
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
        lines.push(`### Completed (${completed.length})`);
        for (const t of completed) {
          const id = t.short_id || t.id.slice(0, 8);
          const who = t.assigned_to ? ` — ${t.assigned_to}` : "";
          lines.push(`- **${id}**: ${t.title}${who}`);
        }
        lines.push("");
      }

      if (inProgress.length > 0) {
        lines.push(`### In Progress (${inProgress.length})`);
        for (const t of inProgress) {
          const id = t.short_id || t.id.slice(0, 8);
          const who = t.assigned_to ? ` — ${t.assigned_to}` : "";
          lines.push(`- **${id}**: ${t.title}${who}`);
        }
        lines.push("");
      }

      if (failed.length > 0) {
        lines.push(`### Failed (${failed.length})`);
        for (const t of failed) {
          const id = t.short_id || t.id.slice(0, 8);
          lines.push(`- **${id}**: ${t.title}`);
        }
        lines.push("");
      }

      lines.push(`### Pending: ${allTasks.length} task${allTasks.length !== 1 ? "s" : ""} remaining`);

      console.log(lines.join("\n"));
    });

  // doctor
  program
    .command("doctor")
    .description("Diagnose common task data issues")
    .option("--fix", "Auto-fix recoverable issues where possible")
    .option("-j, --json", "Output as JSON")
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
      const recurring = listTasks({ status: ["pending", "in_progress"] as any }).filter(t => (t as any).recurrence_rule);
      const invalidRecurrence = recurring.filter(t => !isValidRecurrenceRule((t as any).recurrence_rule));
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
        const icon = issue.severity === "error" ? chalk.red("x") : issue.severity === "warn" ? chalk.yellow("!") : chalk.green("✓");
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
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const checks: { name: string; ok: boolean; message: string }[] = [];

      // 1. Database check
      try {
        const db = getDatabase();
        const row = db.query("SELECT COUNT(*) as count FROM tasks").get() as { count: number };
        const { statSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dbPath = process.env["TODOS_DB_PATH"] || join(process.env["HOME"] || "~", ".todos", "todos.db");
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
        const { loadConfig } = await import("../../lib/config.js");
        loadConfig();
        checks.push({ name: "Config", ok: true, message: "Loaded successfully" });
      } catch (e) {
        checks.push({ name: "Config", ok: false, message: e instanceof Error ? e.message : "Failed" });
      }

      // 4. Task stats
      try {
        const allTasks = listTasks({});
        const stale = allTasks.filter(t => t.status === "in_progress" && new Date(t.updated_at).getTime() < Date.now() - 30 * 60 * 1000);
        const overdue = allTasks.filter(t => (t as any).recurrence_rule && t.status === "pending" && t.due_at && t.due_at < new Date().toISOString());
        const msg = `${allTasks.length} tasks${stale.length > 0 ? ` · ${stale.length} stale` : ""}${overdue.length > 0 ? ` · ${overdue.length} overdue recurring` : ""}`;
        checks.push({ name: "Tasks", ok: stale.length === 0 && overdue.length === 0, message: msg });
      } catch (e) {
        checks.push({ name: "Tasks", ok: false, message: "Failed to read tasks" });
      }

      // Version check
      const { getPackageVersion } = await import("../helpers.js");
      checks.push({ name: "Version", ok: true, message: `v${getPackageVersion()} · todos-mcp, todos-serve` });

      if (opts.json || globalOpts.json) {
        const ok = checks.every(c => c.ok);
        console.log(JSON.stringify({ ok, checks }));
        return;
      }

      console.log(chalk.bold("todos health\n"));
      for (const c of checks) {
        const icon = c.ok ? chalk.green("✓") : chalk.yellow("!");
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
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const days = parseInt(opts.days, 10);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const projectId = opts.project || autoProject(globalOpts);

      const filter: Record<string, unknown> = {};
      if (projectId) filter.project_id = projectId;

      const { getTasksChangedSince, getTaskStats } = await import("../../db/tasks.js");
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
      const sparkline = dayValues.map(v => "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588"[Math.min(7, Math.floor((v / maxDay) * 7))] || "\u2581").join("");

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
        lines.push(`| Active tasks | ${all.length} total (${stats.by_status?.pending ?? 0} pending, ${stats.by_status?.in_progress ?? 0} active) |`);
        lines.push(`| Changed (${days}d) | ${changed.length} tasks |`);
        lines.push(`| Completed (${days}d) | ${completed.length} (${completionRate}% rate) |`);
        lines.push(`| Failed (${days}d) | ${failed.length} |`);
        if (sparkline) lines.push(`| Activity | \`${sparkline}\` |`);
      } else {
        lines.push(chalk.bold(`todos report — last ${days} day${days !== 1 ? "s" : ""}`));
        lines.push("");
        lines.push(`  Total:      ${chalk.bold(String(all.length))} tasks (${chalk.yellow(String(stats.by_status?.pending ?? 0))} pending, ${chalk.blue(String(stats.by_status?.in_progress ?? 0))} active)`);
        lines.push(`  Changed:    ${chalk.bold(String(changed.length))} in period`);
        lines.push(`  Completed:  ${chalk.green(String(completed.length))} (${completionRate}% rate)`);
        if (failed.length > 0) lines.push(`  Failed:     ${chalk.red(String(failed.length))}`);
        if (sparkline) lines.push(`  Activity:   ${chalk.dim(sparkline)}`);
        if (Object.keys(byAgent).length > 0) {
          lines.push(`  By agent:   ${Object.entries(byAgent).map(([a, n]) => `${a}=${n}`).join(" ")}`);
        }
        if ((stats.by_status?.in_progress ?? 0) > 0) lines.push(`  Stale risk: check \`todos stale\` for stuck tasks`);
      }

      console.log(lines.join("\n"));
    });

  // today
  program
    .command("today")
    .description("Show task activity from today")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const { getTasksChangedSince } = await import("../../db/tasks.js");
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
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const { getTasksChangedSince } = await import("../../db/tasks.js");
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
    .command("mine <agent>")
    .description("Show tasks assigned to you, grouped by status")
    .option("-j, --json", "Output as JSON")
    .action(async (agent: string, opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const projectId = globalOpts.project ? (autoProject(globalOpts) || undefined) : undefined;
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
      const statusIcons: Record<string, string> = { in_progress: ">", pending: "o", blocked: "x", completed: "+", failed: "x", cancelled: "-" };
      const statusClr: Record<string, (s: string) => string> = { in_progress: chalk.blue, pending: chalk.white, blocked: chalk.red, completed: chalk.green, failed: chalk.red, cancelled: chalk.dim };
      console.log(chalk.bold(`Tasks for ${agent} (${tasks.length} total):\n`));
      for (const status of statusOrder) {
        const group = groups[status];
        if (!group || group.length === 0) continue;
        const color = statusClr[status] || chalk.white;
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
    .option("-j, --json", "Output as JSON")
    .option("--project <id>", "Filter to project")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const { getBlockingDeps } = await import("../../db/tasks.js");
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
          console.log(`    ${chalk.red("x")} ${chalk.dim(bl.short_id || bl.id.slice(0, 8))} ${chalk.dim(bl.title)} ${chalk.yellow(`[${bl.status}]`)}`);
        }
      }
    });

  // overdue
  program
    .command("overdue")
    .description("Show tasks past their due date")
    .option("-j, --json", "Output as JSON")
    .option("--project <id>", "Filter to project")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts) || opts.project || undefined;
      const { getOverdueTasks } = await import("../../db/tasks.js");
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
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const { getTasksChangedSince } = await import("../../db/tasks.js");
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
        for (const t of completed) console.log(`    ${chalk.green("+")} ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${t.assigned_to ? chalk.dim(` — ${t.assigned_to}`) : ""}`);
        for (const t of started) console.log(`    ${chalk.blue(">")} ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${t.assigned_to ? chalk.dim(` — ${t.assigned_to}`) : ""}`);
      }
      if (tasks.length === 0) console.log(chalk.dim("  No activity this week."));
    });

  // burndown
  program
    .command("burndown")
    .description("Show task completion velocity over the past 7 days")
    .option("--days <n>", "Number of days", "7")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const { getRecentActivity } = await import("../../db/audit.js");
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
        const completedBar = chalk.green("#".repeat(Math.round((day.completed / maxVal) * barWidth)));
        const createdBar = chalk.blue("-".repeat(Math.round((day.created / maxVal) * barWidth)));
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
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const { getRecentActivity } = await import("../../db/audit.js");
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
        create: chalk.green("+"), start: chalk.blue(">"), complete: chalk.green("+"),
        fail: chalk.red("x"), update: chalk.yellow("~"), approve: chalk.green("*"),
        lock: chalk.dim("[L]"), unlock: chalk.dim("[U]"),
      };
      let lastDate = "";
      for (const e of entries) {
        const date = e.created_at.slice(0, 10);
        const time = e.created_at.slice(11, 16);
        if (date !== lastDate) {
          console.log(chalk.bold(`\n  ${date}`));
          lastDate = date;
        }
        const icon = actionIcons[e.action] || chalk.dim(".");
        const agent = e.agent_id ? chalk.dim(` (${e.agent_id})`) : "";
        const taskRef = chalk.cyan(e.task_id.slice(0, 8));
        let detail = "";
        if (e.field && e.old_value && e.new_value) {
          detail = chalk.dim(` ${e.field}: ${e.old_value} -> ${e.new_value}`);
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
    .option("-j, --json", "Output as JSON")
    .option("--project <id>", "Filter to project")
    .option("--limit <n>", "Max tasks to show", "20")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const { getBlockingDeps } = await import("../../db/tasks.js");
      const { isLockExpired } = await import("../../db/database.js");
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
    .option("-j, --json", "Output as JSON")
    .option("--project <id>", "Filter to project")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const { getBlockingDeps } = await import("../../db/tasks.js");
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
      console.log(chalk.blue(`  > In Progress (${inProgress.length}):`));
      if (inProgress.length === 0) console.log(chalk.dim("    (none)"));
      for (const t of inProgress) {
        const agent = t.assigned_to ? chalk.dim(` — ${t.assigned_to}`) : "";
        console.log(`    ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title}${agent}`);
      }

      // Next up
      console.log(chalk.white(`\n  o Next Up (${nextUp.length}):`));
      if (nextUp.length === 0) console.log(chalk.dim("    (none)"));
      for (const t of nextUp) {
        const pri = t.priority === "critical" ? chalk.bgRed.white(" CRIT ") : t.priority === "high" ? chalk.red("[high]") : "";
        console.log(`    ${chalk.cyan(t.short_id || t.id.slice(0, 8))} ${t.title} ${pri}`);
      }

      // Blocked
      if (blocked.length > 0) {
        console.log(chalk.red(`\n  x Blocked (${blocked.length}):`));
        for (const { task, blockers } of blocked) {
          console.log(`    ${chalk.cyan(task.short_id || task.id.slice(0, 8))} ${task.title}`);
          for (const bl of blockers) console.log(`      ${chalk.dim("<- " + (bl.short_id || bl.id.slice(0, 8)) + " " + bl.title)} ${chalk.yellow(`[${bl.status}]`)}`);
        }
      }

      // Overdue
      if (overdue.length > 0) {
        console.log(chalk.red(`\n  ! Overdue (${overdue.length}):`));
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
    .option("-j, --json", "Output as JSON")
    .option("--limit <n>", "Number of handoffs to show", "5")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const projectId = autoProject(globalOpts) || undefined;

      if (opts.create || opts.summary) {
        if (!opts.summary) { console.error(chalk.red("  --summary is required for creating a handoff")); process.exit(1); }
        const handoff = createHandoff({
          agent_id: opts.agent || globalOpts.agent || undefined,
          project_id: projectId,
          summary: opts.summary,
          completed: opts.completed ? opts.completed.split(",").map((s: string) => s.trim()) : undefined,
          in_progress: opts.inProgress ? opts.inProgress.split(",").map((s: string) => s.trim()) : undefined,
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
          console.log(chalk.green(`  + Completed:`));
          for (const c of h.completed) console.log(`    - ${c}`);
        }
        if (h.in_progress?.length) {
          console.log(chalk.blue(`  > In progress:`));
          for (const c of h.in_progress) console.log(`    - ${c}`);
        }
        if (h.blockers?.length) {
          console.log(chalk.red(`  x Blockers:`));
          for (const c of h.blockers) console.log(`    - ${c}`);
        }
        if (h.next_steps?.length) {
          console.log(chalk.cyan(`  -> Next steps:`));
          for (const c of h.next_steps) console.log(`    - ${c}`);
        }
      }
    });

  // priorities
  program
    .command("priorities")
    .description("Show task counts grouped by priority")
    .option("-j, --json", "Output as JSON")
    .option("--project <id>", "Filter to project")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const { countTasks } = await import("../../db/tasks.js");
      const projectId = autoProject(globalOpts) || opts.project || undefined;
      const base = projectId ? { project_id: projectId } : {};
      const priorities = ["critical", "high", "medium", "low", "none"] as const;
      const counts: Record<string, { total: number; pending: number; in_progress: number; completed: number }> = {};
      for (const p of priorities) {
        counts[p] = {
          total: countTasks({ ...base, priority: p === "none" ? undefined : p }, db),
          pending: countTasks({ ...base, priority: p === "none" ? undefined : p, status: "pending" }, db),
          in_progress: countTasks({ ...base, priority: p === "none" ? undefined : p, status: "in_progress" }, db),
          completed: countTasks({ ...base, priority: p === "none" ? undefined : p, status: "completed" }, db),
        };
      }
      if (opts.json || globalOpts.json) { console.log(JSON.stringify(counts)); return; }
      console.log(chalk.bold("Priority Breakdown:\n"));
      const priColors: Record<string, (s: string) => string> = { critical: chalk.bgRed.white, high: chalk.red, medium: chalk.yellow, low: chalk.blue, none: chalk.dim };
      for (const p of priorities) {
        const c = counts[p];
        if (!c || c.total === 0) continue;
        const color = priColors[p] || chalk.white;
        const bar = chalk.green("#".repeat(Math.min(c.completed, 30))) + chalk.blue("-".repeat(Math.min(c.in_progress, 10))) + chalk.dim(".".repeat(Math.min(c.pending, 20)));
        console.log(`  ${color(p.padEnd(9))} ${String(c.total).padStart(4)} total  ${chalk.green(String(c.completed).padStart(3))} done  ${chalk.blue(String(c.in_progress).padStart(3))} active  ${chalk.dim(String(c.pending).padStart(3))} pending  ${bar}`);
      }
    });

  // context
  program
    .command("context")
    .description("Session start context: status, latest handoff, next task, overdue")
    .option("--agent <name>", "Agent name for handoff lookup")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const projectId = autoProject(globalOpts) || undefined;
      const agentName = opts.agent || globalOpts.agent || undefined;
      const filters = projectId ? { project_id: projectId } : undefined;
      const status = getStatus(filters, agentName);
      const nextTask = getNextTask(agentName, filters, db);
      const { getOverdueTasks } = await import("../../db/tasks.js");
      const overdue = getOverdueTasks(projectId, db);
      const handoff = agentName ? getLatestHandoff(agentName, projectId, db) : getLatestHandoff(undefined, projectId, db);

      if (opts.json || globalOpts.json) {
        console.log(JSON.stringify({ status, next_task: nextTask, overdue_count: overdue.length, latest_handoff: handoff, as_of: new Date().toISOString() }));
        return;
      }

      console.log(chalk.bold("Session Context\n"));
      console.log(`  ${status.pending} pending · ${status.in_progress} active · ${status.completed} done · ${status.total} total`);
      if (status.stale_count > 0) console.log(chalk.yellow(`  ! ${status.stale_count} stale tasks`));
      if (overdue.length > 0) console.log(chalk.red(`  ! ${overdue.length} overdue tasks`));

      if (nextTask) {
        const pri = nextTask.priority === "critical" || nextTask.priority === "high" ? chalk.red(` [${nextTask.priority}]`) : "";
        console.log(chalk.bold(`\n  Next up:`));
        console.log(`    ${chalk.cyan(nextTask.short_id || nextTask.id.slice(0, 8))} ${nextTask.title}${pri}`);
      }

      if (handoff) {
        console.log(chalk.bold(`\n  Last handoff (${handoff.agent_id || "unknown"}, ${handoff.created_at.slice(0, 16).replace("T", " ")}):`));
        console.log(`    ${handoff.summary}`);
        if (handoff.next_steps?.length) {
          for (const s of handoff.next_steps) console.log(`    -> ${s}`);
        }
      }

      console.log(chalk.dim(`\n  as_of: ${new Date().toISOString()}`));
    });

  // report-failure
  program
    .command("report-failure")
    .description("Create a task from a test/build/typecheck failure and auto-assign it")
    .requiredOption("--error <message>", "Error message or summary")
    .option("--type <type>", "Failure type: test, build, typecheck, runtime, other", "test")
    .option("--file <path>", "File where failure occurred")
    .option("--stack <trace>", "Stack trace or detailed output")
    .option("--title <title>", "Custom task title (auto-generated if omitted)")
    .option("--priority <p>", "Priority: low, medium, high, critical")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const { createTask } = await import("../../db/tasks.js");
      const { autoAssignTask } = await import("../../lib/auto-assign.js");
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

      console.log(chalk.green(`Created task ${task.short_id || task.id.slice(0, 8)}: ${task.title}`));
      if (assignResult.agent_name) {
        console.log(chalk.cyan(`  Assigned to: ${assignResult.agent_name} (via ${assignResult.method})`));
        if (assignResult.reason) console.log(chalk.dim(`  Reason: ${assignResult.reason}`));
      }
    });
}
