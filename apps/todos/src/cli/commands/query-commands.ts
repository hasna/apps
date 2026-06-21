import type { Command } from "commander";
import chalk from "chalk";
import { readFileSync, writeFileSync } from "node:fs";
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
  getEscalatedTasks,
  logTime,
  startFocusSession,
  listFocusSessions,
  pauseFocusSession,
  resumeFocusSession,
  stopFocusSession,
  getIdleFocusSessionPrompts,
  getTimeReport,
  buildTaskBoardSnapshot,
  createTaskBoard,
  deleteTaskBoard,
  exportTaskBoardBundle,
  importTaskBoardBundle,
  listTaskBoards,
  moveBoardCard,
  renderTaskBoard,
  createCalendarItem,
  exportCalendarIcs,
  importCalendarIcs,
  listCalendarEvents,
} from "../../db/tasks.js";
import { getRecap } from "../../db/audit.js";
import {
  acknowledgeHandoff,
  createHandoff,
  createSessionRecoveryHandoff,
  exportHandoffBundle,
  getHandoff,
  importHandoffBundle,
  listHandoffs,
  getLatestHandoff,
} from "../../db/handoffs.js";
import { findDuplicateTasks, mergeDuplicateTask } from "../../lib/task-dedupe.js";
import { getTaskLocalFields, queryTasksByLocalFields, setTaskLocalFields } from "../../lib/local-fields.js";
import type { LocalTaskFieldQuery, SetTaskLocalFieldsInput } from "../../lib/local-fields.js";
import {
  listWorkflowStates,
  migrateWorkflowStates,
  queryTasksByWorkflowState,
  renderWorkflowStatesMarkdown,
  setTaskWorkflowState,
} from "../../lib/workflow-states.js";
import { createLocalReport, renderLocalReportMarkdown } from "../../lib/local-reports.js";
import type { BoardLane, BoardScope, CalendarEventKind, TaskPriority } from "../../types/index.js";
import { autoProject, handleError, output, formatTaskLine, resolveTaskId } from "../helpers.js";

function parseJsonObjectOption(value: string | undefined, label: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return parsed as Record<string, unknown>;
  } catch {
    console.error(chalk.red(`${label} must be a valid JSON object`));
    process.exit(1);
  }
}

function parseCsvOption(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function resolveOptionalId(table: "plans" | "task_runs", value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (table === "task_runs") {
    const db = getDatabase();
    if (value.length >= 36) return value;
    const rows = db.query("SELECT id FROM task_runs WHERE id LIKE ?").all(`${value}%`) as { id: string }[];
    if (rows.length === 1) return rows[0]!.id;
    console.error(chalk.red(`Could not resolve run ID: ${value}`));
    process.exit(1);
  }
  const resolved = resolvePartialId(getDatabase(), table, value);
  if (!resolved) {
    console.error(chalk.red(`Could not resolve ${table.slice(0, -1)} ID: ${value}`));
    process.exit(1);
  }
  return resolved;
}

function resolveProjectOption(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const resolved = resolvePartialId(getDatabase(), "projects", value);
  if (!resolved) {
    console.error(chalk.red(`Could not resolve project ID: ${value}`));
    process.exit(1);
  }
  return resolved;
}

function resolveFocusSessionId(value: string): string {
  if (value.length >= 36) return value;
  const rows = getDatabase().query("SELECT id FROM focus_sessions WHERE id LIKE ?").all(`${value}%`) as { id: string }[];
  if (rows.length === 1) return rows[0]!.id;
  console.error(chalk.red(`Could not resolve focus session ID: ${value}`));
  process.exit(1);
}

function parseFieldPairs(values: string[] | undefined): Record<string, unknown> | undefined {
  if (!values || values.length === 0) return undefined;
  const result: Record<string, unknown> = {};
  for (const raw of values) {
    const index = raw.indexOf("=");
    if (index <= 0) {
      console.error(chalk.red("--field entries must use key=value format"));
      process.exit(1);
    }
    result[raw.slice(0, index).trim()] = raw.slice(index + 1);
  }
  return result;
}

function mergeCustomFields(
  jsonFields: Record<string, unknown> | undefined,
  pairFields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!jsonFields && !pairFields) return undefined;
  return { ...(jsonFields || {}), ...(pairFields || {}) };
}

function parsePriority(value: string | undefined): TaskPriority | undefined {
  if (!value) return undefined;
  if (!["low", "medium", "high", "critical"].includes(value)) {
    console.error(chalk.red("--priority must be one of: low, medium, high, critical"));
    process.exit(1);
  }
  return value as TaskPriority;
}

function parseBoardScope(value: string | undefined): BoardScope {
  if (!value) return "tasks";
  if (value !== "tasks" && value !== "plans") {
    console.error(chalk.red("--scope must be tasks or plans"));
    process.exit(1);
  }
  return value;
}

function parseBoardLane(value: string, position: number): BoardLane {
  const [labelPart, statusPart] = value.split("=");
  if (!labelPart || !statusPart) {
    console.error(chalk.red("--lane must use Name=status,status[:wip_limit] format"));
    process.exit(1);
  }
  const [statusesRaw, limitRaw] = statusPart.split(":");
  const statuses = statusesRaw!.split(",").map((status) => status.trim()).filter(Boolean);
  if (statuses.length === 0) {
    console.error(chalk.red("--lane must include at least one status"));
    process.exit(1);
  }
  const name = labelPart.trim();
  const wipLimit = limitRaw === undefined || limitRaw === "" ? null : parseInt(limitRaw, 10);
  if (wipLimit !== null && (!Number.isFinite(wipLimit) || wipLimit < 1)) {
    console.error(chalk.red("lane WIP limit must be a positive integer"));
    process.exit(1);
  }
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `lane-${position + 1}`,
    name,
    statuses,
    wip_limit: wipLimit,
    position,
  };
}

function parseBoardLanes(values: string[] | undefined): BoardLane[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((value, index) => parseBoardLane(value, index));
}

function parseCalendarKind(value: string | undefined): CalendarEventKind | undefined {
  if (!value) return undefined;
  const allowed = ["task_due", "task_sla", "task_reminder", "milestone", "work_block", "run", "imported"];
  if (!allowed.includes(value)) {
    console.error(chalk.red(`--kind must be one of: ${allowed.join(", ")}`));
    process.exit(1);
  }
  return value as CalendarEventKind;
}

function parseQuietHoursOption(value: string | undefined, timezone: string | undefined): { start: string; end: string; timezone: "utc" | "local" } | undefined {
  if (!value) return undefined;
  const [start, end] = value.split("-", 2).map((part) => part.trim());
  const clock = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  if (!start || !end || !clock.test(start) || !clock.test(end)) {
    console.error(chalk.red("--quiet-hours must use HH:MM-HH:MM"));
    process.exit(1);
  }
  const tz = timezone === "utc" ? "utc" : "local";
  return { start, end, timezone: tz };
}

export function registerQueryCommands(program: Command) {
  const references = program
    .command("references")
    .alias("refs")
    .description("Resolve local file, symbol, git, plan, run, task, and agent references");

  references
    .command("resolve <mentions...>")
    .description("Resolve mentions using only local workspace, git, and todos state")
    .option("--workspace <path>", "Workspace root for file, symbol, and git references")
    .option("--max-symbol-matches <n>", "Maximum symbol matches per symbol mention", "20")
    .option("-j, --json", "Output as JSON")
    .action(async (mentions: string[], opts: { workspace?: string; maxSymbolMatches?: string; json?: boolean }) => {
      const globalOpts = program.opts();
      const { resolveMentions } = await import("../../lib/mention-resolver.js");
      const report = resolveMentions({
        mentions,
        workspace: opts.workspace || globalOpts.project || process.cwd(),
        max_symbol_matches: Number.parseInt(opts.maxSymbolMatches || "20", 10),
      });
      if (opts.json || globalOpts.json) {
        output(report, true);
        return;
      }
      console.log(chalk.bold("Resolved references"));
      for (const reference of report.references) {
        const status = reference.resolved ? chalk.green("ok") : chalk.yellow("missing");
        const label = reference.title || reference.canonical || reference.target;
        console.log(`  ${status} ${reference.kind.padEnd(12)} ${reference.input} -> ${label}`);
        for (const warning of reference.warnings) {
          console.log(chalk.dim(`    ${warning}`));
        }
      }
      if (report.backlinks.length > 0) {
        console.log(chalk.dim(`  backlinks: ${report.backlinks.map((item) => item.key).join(", ")}`));
      }
    });

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
    .option("--steal-stale", "Steal the highest-priority stale task when no pending task is available")
    .option("--stale-minutes <n>", "How long a task must be stale before stealing (default: 30)", "30")
    .option("-j, --json", "Output as JSON")
    .action(async (agent, opts) => {
      const db = getDatabase();
      const filters: Record<string, string> = {};
      if (opts.project) filters.project_id = opts.project;
      const task = opts.stealStale
        ? (await import("../../db/tasks.js")).claimOrSteal(agent, { ...filters, stale_minutes: parseInt(opts.staleMinutes, 10) }, db)?.task ?? null
        : claimNextTask(agent, Object.keys(filters).length ? filters : undefined, db);
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
      const projectId = opts.project ? resolvePartialId(db, "projects", opts.project) ?? opts.project : autoProject(globalOpts) ?? undefined;
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
    .description("Diagnose and optionally repair local task data issues")
    .option("--apply", "Apply safe repairs. Defaults to dry-run.")
    .option("--fix", "Alias for --apply")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const { runTodosDoctor } = await import("../../lib/doctor.js");
      const result = runTodosDoctor({ apply: Boolean(opts.apply || opts.fix) });

      if (opts.json || globalOpts.json) {
        console.log(JSON.stringify(result));
        return;
      }

      console.log(chalk.bold("todos doctor\n"));
      console.log(`  ${chalk.dim("Mode:")} ${result.dry_run ? "dry-run" : "apply"}`);
      console.log(`  ${chalk.dim("Database:")} ${result.database_path}`);
      if (result.backup) console.log(`  ${chalk.dim("Backup:")} ${result.backup.path}`);
      console.log("");
      for (const check of result.checks) {
        const icon = check.severity === "error" ? chalk.red("x") : check.severity === "warn" ? chalk.yellow("!") : chalk.green("✓");
        const count = check.count === undefined ? "" : ` (${check.count})`;
        console.log(`  ${icon} ${check.message}${count}`);
      }
      if (result.repairs.length > 0) {
        console.log(chalk.bold("\nRepairs"));
        for (const repair of result.repairs) {
          const icon = repair.applied ? chalk.green("✓") : chalk.yellow("!");
          const count = repair.count === undefined ? "" : ` (${repair.count})`;
          console.log(`  ${icon} ${repair.message}${count}`);
        }
      }
      const { errors, warnings } = result.summary;
      if (errors === 0 && warnings === 0) console.log(chalk.green("\n  All clear."));
      else if (result.dry_run) console.log(chalk[errors > 0 ? "red" : "yellow"](`\n  ${errors} error(s), ${warnings} warning(s). Run with --apply to apply safe repairs after reviewing the dry-run.`));
      else console.log(chalk[errors > 0 ? "red" : "yellow"](`\n  ${errors} error(s), ${warnings} warning(s) remain after repair.`));
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
        const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
        const dbPath = process.env["HASNA_TODOS_DB_PATH"] || process.env["TODOS_DB_PATH"] || join(home, ".hasna", "todos", "todos.db");
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

  program
    .command("sla")
    .description("Show overdue or SLA-breached tasks that need escalation")
    .option("-j, --json", "Output as JSON")
    .option("--project <id>", "Filter to project")
    .option("--agent <id>", "Filter to assigned agent")
    .option("--limit <n>", "Max tasks to show", "50")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const projectId = autoProject(globalOpts) || opts.project || undefined;
      const escalations = getEscalatedTasks({
        project_id: projectId,
        agent_id: opts.agent,
      }).slice(0, parseInt(opts.limit, 10));
      if (opts.json || globalOpts.json) {
        console.log(JSON.stringify(escalations));
        return;
      }
      if (escalations.length === 0) {
        console.log(chalk.green("  No SLA breaches or overdue tasks."));
        return;
      }
      console.log(chalk.bold.red(`Escalations (${escalations.length}):\n`));
      for (const item of escalations) {
        const task = item.task;
        const reasons = item.reasons.map((reason) => reason === "sla_breached" ? "SLA" : "overdue").join(",");
        console.log(`  ${chalk.red(reasons)} ${chalk.cyan(task.short_id || task.id.slice(0, 8))} ${task.title}${task.assigned_to ? chalk.dim(` — ${task.assigned_to}`) : ""} ${chalk.dim(`since ${item.breached_at}`)}`);
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

  // timeline
  program
    .command("timeline")
    .description("Show a unified local activity timeline for tasks, projects, plans, or runs")
    .option("--task <id>", "Filter to a task")
    .option("--project <id>", "Filter to a project")
    .option("--plan <id>", "Filter to a plan")
    .option("--run <id>", "Filter to a run ledger")
    .option("--since <iso>", "Only include entries at or after this ISO timestamp")
    .option("--until <iso>", "Only include entries at or before this ISO timestamp")
    .option("--limit <n>", "Number of entries", "50")
    .option("--offset <n>", "Entries to skip", "0")
    .option("--order <order>", "Sort order: asc or desc", "desc")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const { getLocalActivityTimeline } = await import("../../lib/activity-timeline.js");
      const { resolveTaskRunId } = await import("../../db/task-runs.js");
      const options: Parameters<typeof getLocalActivityTimeline>[0] = {
        since: opts.since,
        until: opts.until,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
        order: opts.order === "asc" ? "asc" : "desc",
      };
      if (opts.task) {
        options.entity_type = "task";
        options.entity_id = resolveTaskId(opts.task);
      } else if (opts.project) {
        const projectId = resolvePartialId(db, "projects", opts.project);
        if (!projectId) throw new Error(`Could not resolve project ID: ${opts.project}`);
        options.entity_type = "project";
        options.entity_id = projectId;
      } else if (opts.plan) {
        const planId = resolvePartialId(db, "plans", opts.plan);
        if (!planId) throw new Error(`Could not resolve plan ID: ${opts.plan}`);
        options.entity_type = "plan";
        options.entity_id = planId;
      } else if (opts.run) {
        options.entity_type = "run";
        options.entity_id = resolveTaskRunId(opts.run, db);
      }

      const timeline = getLocalActivityTimeline(options, db);
      if (opts.json || globalOpts.json) {
        console.log(JSON.stringify(timeline, null, 2));
        return;
      }
      if (timeline.entries.length === 0) {
        console.log(chalk.dim("  No activity yet."));
        return;
      }
      console.log(chalk.bold(`Activity timeline (${timeline.total}${timeline.total > timeline.entries.length ? `, showing ${timeline.entries.length}` : ""}):\n`));
      for (const entry of timeline.entries) {
        const time = entry.created_at.replace("T", " ").slice(0, 16);
        const ref = entry.run_id ? `run ${entry.run_id.slice(0, 8)}` : `task ${entry.task_id.slice(0, 8)}`;
        const agent = entry.agent_id ? chalk.dim(` (${entry.agent_id})`) : "";
        const message = entry.message ? ` ${entry.message}` : "";
        console.log(`  ${chalk.dim(time)} ${chalk.cyan(entry.source)} ${chalk.dim(ref)} ${entry.event_type}${message}${agent}`);
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

  const reports = program
    .command("reports")
    .description("Build local agent-native reports from tasks, plans, runs, and verification evidence");

  reports
    .command("local")
    .description("Build a local JSON or Markdown report for agent planning and standups")
    .option("--project <id>", "Filter to project")
    .option("--plan <id>", "Filter to plan")
    .option("--agent <id>", "Filter to agent or assignee")
    .option("--since <iso>", "Only include task, run, and verification activity since this timestamp")
    .option("--until <iso>", "Only include task, run, and verification activity until this timestamp")
    .option("--limit <n>", "Maximum rows per report section", "20")
    .option("--format <format>", "Output format: json or markdown", "markdown")
    .option("-j, --json", "Output JSON")
    .action((opts) => {
      const globalOpts = program.opts();
      try {
        const report = createLocalReport({
          project_id: resolveProjectOption(opts.project) || autoProject(globalOpts) || undefined,
          plan_id: resolveOptionalId("plans", opts.plan),
          agent_id: opts.agent || globalOpts.agent || undefined,
          since: opts.since,
          until: opts.until,
          limit: Number(opts.limit),
        });
        if (opts.json || globalOpts.json || opts.format === "json") {
          output(report, true);
          return;
        }
        console.log(renderLocalReportMarkdown(report));
      } catch (e) {
        handleError(e);
      }
    });

  // handoff
  program
    .command("handoff")
    .description("Create or view agent session handoffs")
    .option("--create", "Create a new handoff")
    .option("--read <id>", "Read one handoff by ID or prefix")
    .option("--export <id>", "Export one handoff bundle by ID or prefix")
    .option("--import <file>", "Import a handoff bundle from a JSON file")
    .option("--output <path>", "Write exported handoff bundle to a file")
    .option("--apply", "Apply an imported handoff bundle; imports default to dry-run preview")
    .option("--ack <id>", "Acknowledge a handoff as read for an agent")
    .option("--recover", "Create a recovery handoff from active stale session context")
    .option("--agent <name>", "Agent name")
    .option("--session <id>", "Session ID for handoff or recovery context")
    .option("--summary <text>", "Handoff summary")
    .option("--completed <items>", "Comma-separated completed items")
    .option("--in-progress <items>", "Comma-separated in-progress items")
    .option("--blockers <items>", "Comma-separated blockers")
    .option("--next <items>", "Comma-separated next steps")
    .option("--tasks <ids>", "Comma-separated task IDs or prefixes")
    .option("--files <paths>", "Comma-separated relevant files")
    .option("--runs <ids>", "Comma-separated run IDs")
    .option("--unread-for <agent>", "Only list handoffs not acknowledged by this agent")
    .option("--reason <text>", "Recovery reason")
    .option("-j, --json", "Output as JSON")
    .option("--limit <n>", "Number of handoffs to show", "5")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const db = getDatabase();
      const projectId = autoProject(globalOpts) || undefined;
      const actor = opts.agent || globalOpts.agent || undefined;
      const sessionId = opts.session || globalOpts.session || undefined;

      try {
        if (opts.import) {
          const bundle = JSON.parse(readFileSync(opts.import, "utf-8"));
          const result = importHandoffBundle(bundle, { apply: opts.apply }, db);
          if (opts.json || globalOpts.json) { console.log(JSON.stringify(result)); return; }
          console.log(opts.apply
            ? chalk.green(`  ✓ Handoff bundle imported: ${result.handoff_id.slice(0, 8)}`)
            : chalk.cyan(`  Handoff bundle preview: ${result.handoff_id.slice(0, 8)}`));
          if (result.warnings.length) for (const warning of result.warnings) console.log(chalk.yellow(`  ! ${warning}`));
          return;
        }

        if (opts.export) {
          const bundle = exportHandoffBundle(opts.export, db);
          const json = JSON.stringify(bundle, null, 2);
          if (opts.output) {
            writeFileSync(opts.output, `${json}\n`);
            if (opts.json || globalOpts.json) { console.log(JSON.stringify({ path: opts.output, handoff_id: bundle.handoff.id })); return; }
            console.log(chalk.green(`  ✓ Handoff bundle written: ${opts.output}`));
            return;
          }
          console.log(json);
          return;
        }

        if (opts.read) {
          const handoff = getHandoff(opts.read, db);
          if (!handoff) { console.error(chalk.red(`Handoff not found: ${opts.read}`)); process.exit(1); }
          if (opts.json || globalOpts.json) { console.log(JSON.stringify(handoff)); return; }
          printHandoff(handoff);
          return;
        }

        if (opts.ack) {
          if (!actor) { console.error(chalk.red("  --agent is required with --ack")); process.exit(1); }
          const handoff = acknowledgeHandoff(opts.ack, actor, db);
          if (opts.json || globalOpts.json) { console.log(JSON.stringify(handoff)); return; }
          console.log(chalk.green(`  ✓ Handoff ${handoff.id.slice(0, 8)} acknowledged by ${actor}`));
          return;
        }

        if (opts.recover) {
          if (!actor) { console.error(chalk.red("  --agent is required with --recover")); process.exit(1); }
          const handoff = createSessionRecoveryHandoff({
            agent_id: actor,
            session_id: sessionId,
            project_id: projectId,
            recovered_by: globalOpts.agent || actor,
            reason: opts.reason,
            limit: parseInt(opts.limit, 10),
          }, db);
          if (opts.json || globalOpts.json) { console.log(JSON.stringify(handoff)); return; }
          console.log(chalk.green(`  ✓ Recovery handoff created for ${actor}`));
          return;
        }

        if (opts.create || opts.summary) {
          if (!opts.summary) { console.error(chalk.red("  --summary is required for creating a handoff")); process.exit(1); }
          const handoff = createHandoff({
            agent_id: actor,
            project_id: projectId,
            session_id: sessionId,
            summary: opts.summary,
            completed: parseCsvOption(opts.completed),
            in_progress: parseCsvOption(opts.inProgress),
            blockers: parseCsvOption(opts.blockers),
            next_steps: parseCsvOption(opts.next),
            task_ids: parseCsvOption(opts.tasks)?.map((id) => resolveTaskId(id)),
            relevant_files: parseCsvOption(opts.files),
            run_ids: parseCsvOption(opts.runs),
          }, db);
          if (opts.json || globalOpts.json) { console.log(JSON.stringify(handoff)); return; }
          console.log(chalk.green(`  ✓ Handoff created by ${handoff.agent_id || "unknown"}`));
          return;
        }

        // View mode — show recent handoffs
        const handoffs: any[] = listHandoffs({
          project_id: projectId,
          agent_id: opts.agent && !opts.unreadFor ? opts.agent : undefined,
          unread_for: opts.unreadFor,
          limit: parseInt(opts.limit, 10),
        }, db);
        if (opts.json || globalOpts.json) { console.log(JSON.stringify(handoffs)); return; }
        if (handoffs.length === 0) { console.log(chalk.dim("  No handoffs yet.")); return; }

        for (const h of handoffs) printHandoff(h);
      } catch (error) {
        handleError(error);
      }
    });

  function printHandoff(h: any): void {
    const time = h.created_at.slice(0, 16).replace("T", " ");
    console.log(chalk.bold(`\n  ${time} ${h.agent_id || "unknown"}`));
    console.log(`  ${h.summary}`);
    if (h.session_id) console.log(chalk.dim(`  session: ${h.session_id}`));
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
    if (h.task_ids?.length || h.relevant_files?.length || h.run_ids?.length) {
      console.log(chalk.dim(`  context: ${h.task_ids?.length || 0} tasks · ${h.relevant_files?.length || 0} files · ${h.run_ids?.length || 0} runs`));
    }
    if (h.acknowledged_by?.length) {
      console.log(chalk.dim(`  read by: ${h.acknowledged_by.join(", ")}`));
    }
  }

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

  program
    .command("release-notes")
    .description("Generate local release notes and changelog output from completed tasks")
    .option("--project <id>", "Project filter")
    .option("--plan <id>", "Plan filter")
    .option("--task <ids>", "Comma-separated task IDs or prefixes")
    .option("--tag <tag>", "Only include completed tasks with a tag")
    .option("--since <iso>", "Only include tasks completed at or after this ISO timestamp")
    .option("--until <iso>", "Only include tasks completed at or before this ISO timestamp")
    .option("--title <text>", "Release notes title", "Release Notes")
    .option("--version <version>", "Release version label")
    .option("--format <format>", "Output format: markdown or json", "markdown")
    .option("--out <path>", "Write output to a local file")
    .option("-j, --json", "Output JSON")
    .action(async (opts) => {
      try {
        const globalOpts = program.opts();
        const format = (opts.json || globalOpts.json) ? "json" : opts.format;
        if (!["markdown", "json"].includes(format)) {
          console.error(chalk.red("Invalid --format. Allowed values: markdown, json."));
          process.exit(1);
        }
        const { generateReleaseNotes, renderReleaseNotesMarkdown } = await import("../../lib/release-notes.js");
        const projectInput = opts.project || globalOpts.project;
        const document = generateReleaseNotes({
          project_id: autoProject({ project: projectInput }) || resolveProjectOption(projectInput),
          plan_id: resolveOptionalId("plans", opts.plan),
          task_ids: opts.task ? String(opts.task).split(",").map((id) => resolveTaskId(id.trim())).filter(Boolean) : undefined,
          tag: opts.tag,
          since: opts.since,
          until: opts.until,
          title: opts.title,
          version: opts.version,
        });
        const content = format === "json" ? JSON.stringify(document, null, 2) : renderReleaseNotesMarkdown(document);
        if (opts.out) {
          writeFileSync(opts.out, content);
          if (format !== "json") console.log(chalk.green(`Wrote release notes to ${opts.out}`));
          return;
        }
        console.log(content);
      } catch (e) {
        handleError(e);
      }
    });

  program
    .command("context-pack <task-id>")
    .description("Build a deterministic local agent context pack for a task")
    .option("--profile <profile>", "Agent profile: codex, claude, takumi, generic", "generic")
    .option("--format <format>", "Output format: markdown or json", "markdown")
    .option("--run <id>", "Limit run evidence to a specific run ID or prefix")
    .option("--comments <n>", "Recent comments to include", "8")
    .option("--files <n>", "Relevant files to include", "24")
    .option("--verifications <n>", "Verification records to include", "10")
    .option("--runs <n>", "Run ledgers to include", "3")
    .option("--dependencies <n>", "Dependencies per direction to include", "12")
    .option("--plan-tasks <n>", "Plan sibling tasks to include", "20")
    .option("--max-text <n>", "Max characters for long text fields", "6000")
    .option("--summary-chars <n>", "Max characters for local omission summaries", "480")
    .option("--token-budget <n>", "Approximate token budget for compacting context locally")
    .option("--include <sections>", "Comma-separated sections to include before budgeting")
    .option("--exclude <sections>", "Comma-separated sections to omit before budgeting")
    .option("--compact", "Render compact Markdown or minified JSON")
    .option("--stale-after-hours <n>", "Warn when task state is older than this many hours", "72")
    .action(async (taskId: string, opts) => {
      const globalOpts = program.opts();
      const format = globalOpts.json ? "json" : opts.format;
      if (!["codex", "claude", "takumi", "generic"].includes(opts.profile)) {
        console.error(chalk.red("Invalid --profile. Allowed values: codex, claude, takumi, generic."));
        process.exit(1);
      }
      if (!["markdown", "json", "compact-markdown", "compact-json"].includes(format)) {
        console.error(chalk.red("Invalid --format. Allowed values: markdown, json, compact-markdown, compact-json."));
        process.exit(1);
      }
      const { createAgentContextPack, renderAgentContextPack } = await import("../../lib/context-packs.js");
      const pack = createAgentContextPack({
        task_id: resolveTaskId(taskId),
        agent_id: globalOpts.agent,
        profile: opts.profile,
        run_id: opts.run,
        comment_limit: Number(opts.comments),
        file_limit: Number(opts.files),
        verification_limit: Number(opts.verifications),
        run_limit: Number(opts.runs),
        dependency_limit: Number(opts.dependencies),
        plan_task_limit: Number(opts.planTasks),
        max_text_chars: Number(opts.maxText),
        summary_char_limit: Number(opts.summaryChars),
        token_budget: opts.tokenBudget ? Number(opts.tokenBudget) : undefined,
        include_sections: opts.include ? String(opts.include).split(",") : undefined,
        exclude_sections: opts.exclude ? String(opts.exclude).split(",") : undefined,
        compact: Boolean(opts.compact) || String(format).startsWith("compact-"),
        stale_after_hours: Number(opts.staleAfterHours),
      });
      console.log(renderAgentContextPack(pack, format, Boolean(opts.compact)));
    });

  const calendar = program
    .command("calendar")
    .description("List and export local calendar events");

  calendar
    .command("list")
    .description("List local calendar events from tasks, SLA thresholds, runs, and local items")
    .option("--from <iso>", "Start window")
    .option("--to <iso>", "End window")
    .option("--project <id>", "Project filter")
    .option("--task <id>", "Task filter")
    .option("--plan <id>", "Plan filter")
    .option("--kind <kind>", "Event kind filter")
    .option("--include-completed", "Include completed/cancelled tasks")
    .option("--no-runs", "Exclude run events")
    .option("--no-sla", "Exclude SLA threshold events")
    .option("--no-local", "Exclude local calendar items")
    .option("--limit <n>", "Max events", "50")
    .option("-j, --json", "Output JSON")
    .action((opts) => {
      try {
        const globalOpts = program.opts();
        const events = listCalendarEvents({
          project_id: resolveProjectOption(opts.project || globalOpts.project),
          task_id: opts.task ? resolveTaskId(opts.task) : undefined,
          plan_id: resolveOptionalId("plans", opts.plan),
          kind: parseCalendarKind(opts.kind),
          from: opts.from,
          to: opts.to,
          include_completed: Boolean(opts.includeCompleted),
          include_runs: opts.runs,
          include_sla: opts.sla,
          include_local: opts.local,
          limit: Number(opts.limit),
        });
        if (opts.json || globalOpts.json) { output(events, true); return; }
        if (events.length === 0) { console.log(chalk.dim("No calendar events.")); return; }
        for (const event of events) {
          console.log(`${event.starts_at} ${event.kind.padEnd(13)} ${event.title}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  calendar
    .command("add <title>")
    .description("Create a local reminder, milestone, or work block")
    .option("--kind <kind>", "task_reminder, milestone, work_block, imported", "work_block")
    .requiredOption("--start <iso>", "Start timestamp")
    .option("--end <iso>", "End timestamp")
    .option("--timezone <tz>", "Timezone label")
    .option("--project <id>", "Project link")
    .option("--task <id>", "Task link")
    .option("--plan <id>", "Plan link")
    .option("--run <id>", "Run link")
    .option("--rrule <rule>", "Natural recurrence rule or ICS RRULE")
    .option("--description <text>", "Description")
    .option("--metadata <json>", "Metadata JSON object")
    .option("-j, --json", "Output JSON")
    .action((title: string, opts) => {
      try {
        const globalOpts = program.opts();
        const item = createCalendarItem({
          title,
          kind: parseCalendarKind(opts.kind),
          description: opts.description,
          starts_at: opts.start,
          ends_at: opts.end,
          timezone: opts.timezone,
          project_id: resolveProjectOption(opts.project || globalOpts.project),
          task_id: opts.task ? resolveTaskId(opts.task) : undefined,
          plan_id: resolveOptionalId("plans", opts.plan),
          run_id: resolveOptionalId("task_runs", opts.run),
          recurrence_rule: opts.rrule,
          metadata: parseJsonObjectOption(opts.metadata, "--metadata"),
        });
        if (opts.json || globalOpts.json) { output(item, true); return; }
        console.log(chalk.green(`Created calendar item ${item.id.slice(0, 8)}`));
      } catch (e) {
        handleError(e);
      }
    });

  calendar
    .command("export")
    .description("Export deterministic local calendar events as ICS")
    .option("--from <iso>", "Start window")
    .option("--to <iso>", "End window")
    .option("--project <id>", "Project filter")
    .option("--task <id>", "Task filter")
    .option("--plan <id>", "Plan filter")
    .option("--kind <kind>", "Event kind filter")
    .option("--name <text>", "Calendar name", "Hasna Todos")
    .option("--redact", "Redact event summaries and descriptions")
    .option("--out <path>", "Write ICS to file")
    .option("-j, --json", "Output JSON envelope")
    .action((opts) => {
      try {
        const globalOpts = program.opts();
        const exported = exportCalendarIcs({
          calendar_name: opts.name,
          project_id: resolveProjectOption(opts.project || globalOpts.project),
          task_id: opts.task ? resolveTaskId(opts.task) : undefined,
          plan_id: resolveOptionalId("plans", opts.plan),
          kind: parseCalendarKind(opts.kind),
          from: opts.from,
          to: opts.to,
          redact: Boolean(opts.redact),
        });
        if (opts.out) {
          writeFileSync(opts.out, exported.content);
          if (!(opts.json || globalOpts.json)) console.log(chalk.green(`Wrote ${exported.events.length} events to ${opts.out}`));
        }
        if (opts.json || globalOpts.json) { output(exported, true); return; }
        if (!opts.out) console.log(exported.content);
      } catch (e) {
        handleError(e);
      }
    });

  calendar
    .command("import <path>")
    .description("Import VEVENT entries from an ICS file as local imported calendar items")
    .option("-j, --json", "Output JSON")
    .action((path: string, opts) => {
      try {
        const result = importCalendarIcs(readFileSync(path, "utf-8"));
        if (opts.json || program.opts().json) { output(result, true); return; }
        console.log(chalk.green(`Imported ${result.imported} events, skipped ${result.skipped}`));
      } catch (e) {
        handleError(e);
      }
    });

  const notifications = program
    .command("notifications")
    .description("Check local due-date, SLA, stale-task, run, and reminder alerts");

  notifications
    .command("check")
    .description("Evaluate local notification alerts and optionally emit local hooks or terminal watch rules")
    .option("--project <id>", "Project filter")
    .option("--agent <id>", "Agent filter")
    .option("--now <iso>", "Evaluation timestamp")
    .option("--due-within-minutes <n>", "Warn for tasks and reminders due within this many minutes", "60")
    .option("--stale-minutes <n>", "Minutes before an in-progress task is stale", "30")
    .option("--run-since <iso>", "Only include completed run alerts at or after this timestamp")
    .option("--no-runs", "Exclude completed run alerts")
    .option("--no-calendar", "Exclude local calendar reminder alerts")
    .option("--emit-hooks", "Emit matching local event hooks for generated alerts")
    .option("--terminal", "Evaluate terminal notification rules for generated alerts")
    .option("--quiet-hours <range>", "Suppress hook and terminal delivery during HH:MM-HH:MM")
    .option("--quiet-timezone <tz>", "Quiet hours timezone: local or utc", "local")
    .option("--limit <n>", "Max alerts", "100")
    .option("-j, --json", "Output JSON")
    .action(async (opts) => {
      try {
        const globalOpts = program.opts();
        const { checkLocalNotifications } = await import("../../lib/local-notifications.js");
        const result = await checkLocalNotifications({
          project_id: resolveProjectOption(opts.project || globalOpts.project),
          agent_id: opts.agent || globalOpts.agent,
          now: opts.now,
          due_within_minutes: Number(opts.dueWithinMinutes),
          stale_minutes: Number(opts.staleMinutes),
          run_since: opts.runSince,
          include_runs: opts.runs,
          include_calendar: opts.calendar,
          emit_hooks: Boolean(opts.emitHooks),
          evaluate_terminal: Boolean(opts.terminal),
          quiet_hours: parseQuietHoursOption(opts.quietHours, opts.quietTimezone),
          limit: Number(opts.limit),
        });
        if (opts.json || globalOpts.json) { output(result, true); return; }
        if (result.alerts.length === 0) {
          console.log(chalk.dim("No local notification alerts."));
          return;
        }
        for (const alert of result.alerts) {
          const color = alert.severity === "critical" ? chalk.red : alert.severity === "warning" ? chalk.yellow : chalk.cyan;
          const quiet = alert.quieted ? chalk.dim(" quiet") : "";
          console.log(`${color(alert.severity.toUpperCase())} ${alert.event_type} ${alert.title}${quiet}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  const board = program
    .command("board")
    .description("Render local task and plan kanban boards");

  board
    .command("create <name>")
    .description("Create a local kanban board")
    .option("--scope <scope>", "Board scope: tasks or plans", "tasks")
    .option("--project <id>", "Project filter")
    .option("--task-list <id>", "Task list filter")
    .option("--plan <id>", "Plan filter for task boards")
    .option("--agent <id>", "Agent filter")
    .option("--lane <spec...>", "Lane spec: Name=status,status[:wip_limit]")
    .option("--filter <json>", "Saved board filters as JSON")
    .option("-j, --json", "Output JSON")
    .action((name: string, opts) => {
      try {
        const globalOpts = program.opts();
        const scope = parseBoardScope(opts.scope);
        const created = createTaskBoard({
          name,
          scope,
          project_id: resolveProjectOption(opts.project || globalOpts.project),
          task_list_id: opts.taskList,
          plan_id: resolveOptionalId("plans", opts.plan),
          agent_id: opts.agent || globalOpts.agent,
          lanes: parseBoardLanes(opts.lane),
          filters: parseJsonObjectOption(opts.filter, "--filter"),
        });
        if (opts.json || globalOpts.json) { output(created, true); return; }
        console.log(chalk.green(`Created ${created.scope} board ${created.name} (${created.id.slice(0, 8)})`));
      } catch (e) {
        handleError(e);
      }
    });

  board
    .command("list")
    .description("List local kanban boards")
    .option("--scope <scope>", "Filter by tasks or plans")
    .option("--project <id>", "Filter by project")
    .option("--agent <id>", "Filter by agent")
    .option("-j, --json", "Output JSON")
    .action((opts) => {
      try {
        const globalOpts = program.opts();
        const boards = listTaskBoards({
          scope: opts.scope ? parseBoardScope(opts.scope) : undefined,
          project_id: resolveProjectOption(opts.project || globalOpts.project),
          agent_id: opts.agent || globalOpts.agent,
        });
        if (opts.json || globalOpts.json) { output(boards, true); return; }
        if (boards.length === 0) { console.log(chalk.dim("No boards.")); return; }
        for (const item of boards) {
          console.log(`${item.id.slice(0, 8)} ${item.scope.padEnd(5)} ${item.name} (${item.lanes.length} lanes)`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  board
    .command("show <board>")
    .description("Render a local kanban board")
    .option("-j, --json", "Output JSON snapshot")
    .action((boardId: string, opts) => {
      try {
        const snapshot = buildTaskBoardSnapshot(boardId);
        if (opts.json || program.opts().json) { output(snapshot, true); return; }
        console.log(renderTaskBoard(snapshot));
      } catch (e) {
        handleError(e);
      }
    });

  board
    .command("tui <board>")
    .description("Render a keyboard-oriented terminal board snapshot")
    .option("-j, --json", "Output JSON snapshot with key bindings")
    .action((boardId: string, opts) => {
      try {
        const snapshot = buildTaskBoardSnapshot(boardId);
        if (opts.json || program.opts().json) { output(snapshot, true); return; }
        console.log(renderTaskBoard(snapshot));
      } catch (e) {
        handleError(e);
      }
    });

  board
    .command("move <board> <card-id>")
    .description("Move a task or plan card to a lane or explicit status")
    .option("--lane <id>", "Target lane id or name")
    .option("--status <status>", "Explicit target workflow status")
    .option("-j, --json", "Output JSON")
    .action((boardId: string, cardId: string, opts) => {
      try {
        const moved = moveBoardCard({
          board_id: boardId,
          card_id: cardId,
          lane_id: opts.lane,
          status: opts.status,
        });
        if (opts.json || program.opts().json) { output(moved, true); return; }
        console.log(chalk.green(`Moved ${moved.id.slice(0, 8)} to ${moved.status}`));
      } catch (e) {
        handleError(e);
      }
    });

  board
    .command("export [board]")
    .description("Export local board definitions as a portable JSON bundle")
    .option("--out <path>", "Write bundle to file")
    .option("-j, --json", "Output JSON")
    .action((boardId: string | undefined, opts) => {
      try {
        const bundle = exportTaskBoardBundle(boardId);
        const json = JSON.stringify(bundle, null, 2);
        if (opts.out) {
          writeFileSync(opts.out, json);
          if (!(opts.json || program.opts().json)) console.log(chalk.green(`Wrote ${bundle.boards.length} board(s) to ${opts.out}`));
        }
        if (opts.json || program.opts().json || !opts.out) console.log(json);
      } catch (e) {
        handleError(e);
      }
    });

  board
    .command("import <path>")
    .description("Import local board definitions from a JSON bundle")
    .option("-j, --json", "Output JSON")
    .action((path: string, opts) => {
      try {
        const bundle = JSON.parse(readFileSync(path, "utf-8"));
        const result = importTaskBoardBundle(bundle);
        if (opts.json || program.opts().json) { output(result, true); return; }
        console.log(chalk.green(`Imported boards: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped`));
      } catch (e) {
        handleError(e);
      }
    });

  board
    .command("delete <board>")
    .description("Delete a local board definition")
    .option("-j, --json", "Output JSON")
    .action((boardId: string, opts) => {
      try {
        const deleted = deleteTaskBoard(boardId);
        if (opts.json || program.opts().json) { output({ deleted }, true); return; }
        console.log(deleted ? chalk.green("Board deleted") : chalk.dim("Board not found"));
      } catch (e) {
        handleError(e);
      }
    });

  const time = program
    .command("time")
    .description("Track local task time and focus sessions");

  time
    .command("log <task-id> <minutes>")
    .description("Log completed local time against a task")
    .option("--agent <id>", "Agent logging the time")
    .option("--run <id>", "Run ID to link")
    .option("--started-at <iso>", "ISO timestamp when work started")
    .option("--ended-at <iso>", "ISO timestamp when work ended")
    .option("--notes <text>", "Notes about the work")
    .option("-j, --json", "Output JSON")
    .action((taskId: string, minutes: string, opts) => {
      try {
        const globalOpts = program.opts();
        const log = logTime({
          task_id: resolveTaskId(taskId),
          run_id: resolveOptionalId("task_runs", opts.run),
          agent_id: opts.agent || globalOpts.agent,
          minutes: Number(minutes),
          started_at: opts.startedAt,
          ended_at: opts.endedAt,
          notes: opts.notes,
        });
        if (opts.json || globalOpts.json) { output(log, true); return; }
        console.log(chalk.green(`Logged ${log.minutes} min on ${log.task_id.slice(0, 8)}`));
      } catch (e) {
        handleError(e);
      }
    });

  time
    .command("start [task-id]")
    .description("Start a local focus session")
    .option("--plan <id>", "Plan ID to link")
    .option("--run <id>", "Run ID to link")
    .option("--agent <id>", "Agent starting the session")
    .option("--title <text>", "Focus session title")
    .option("--started-at <iso>", "ISO timestamp when focus started")
    .option("--idle-after <minutes>", "Prompt when the session has been active this many minutes")
    .option("--notes <text>", "Session notes")
    .option("-j, --json", "Output JSON")
    .action((taskId: string | undefined, opts) => {
      try {
        const globalOpts = program.opts();
        const session = startFocusSession({
          task_id: taskId ? resolveTaskId(taskId) : undefined,
          plan_id: resolveOptionalId("plans", opts.plan),
          run_id: resolveOptionalId("task_runs", opts.run),
          agent_id: opts.agent || globalOpts.agent,
          title: opts.title,
          started_at: opts.startedAt,
          idle_after_minutes: opts.idleAfter ? Number(opts.idleAfter) : undefined,
          notes: opts.notes,
        });
        if (opts.json || globalOpts.json) { output(session, true); return; }
        console.log(chalk.green(`Started focus session ${session.id.slice(0, 8)}`));
      } catch (e) {
        handleError(e);
      }
    });

  time
    .command("pause <session-id>")
    .description("Pause an active focus session")
    .option("--at <iso>", "ISO pause timestamp")
    .option("-j, --json", "Output JSON")
    .action((sessionId: string, opts) => {
      try {
        const session = pauseFocusSession(resolveFocusSessionId(sessionId), opts.at);
        if (opts.json || program.opts().json) { output(session, true); return; }
        console.log(chalk.yellow(`Paused focus session ${session.id.slice(0, 8)} at ${session.actual_minutes} min`));
      } catch (e) {
        handleError(e);
      }
    });

  time
    .command("resume <session-id>")
    .description("Resume a paused focus session")
    .option("--at <iso>", "ISO resume timestamp")
    .option("-j, --json", "Output JSON")
    .action((sessionId: string, opts) => {
      try {
        const session = resumeFocusSession(resolveFocusSessionId(sessionId), opts.at);
        if (opts.json || program.opts().json) { output(session, true); return; }
        console.log(chalk.green(`Resumed focus session ${session.id.slice(0, 8)}`));
      } catch (e) {
        handleError(e);
      }
    });

  time
    .command("stop <session-id>")
    .description("Stop a focus session and log task time when linked to a task")
    .option("--at <iso>", "ISO stop timestamp")
    .option("--cancel", "Cancel instead of completing; does not create a time log")
    .option("--notes <text>", "Completion notes")
    .option("-j, --json", "Output JSON")
    .action((sessionId: string, opts) => {
      try {
        const session = stopFocusSession({
          id: resolveFocusSessionId(sessionId),
          ended_at: opts.at,
          status: opts.cancel ? "cancelled" : "completed",
          notes: opts.notes,
        });
        if (opts.json || program.opts().json) { output(session, true); return; }
        console.log(chalk.green(`${session.status === "cancelled" ? "Cancelled" : "Stopped"} focus session ${session.id.slice(0, 8)} at ${session.actual_minutes} min`));
      } catch (e) {
        handleError(e);
      }
    });

  time
    .command("list")
    .description("List local focus sessions")
    .option("--task <id>", "Filter by task")
    .option("--plan <id>", "Filter by plan")
    .option("--run <id>", "Filter by run")
    .option("--agent <id>", "Filter by agent")
    .option("--status <status>", "Filter by status")
    .option("--all", "Include completed and cancelled sessions")
    .option("--limit <n>", "Max sessions", "20")
    .option("-j, --json", "Output JSON")
    .action((opts) => {
      try {
        const sessions = listFocusSessions({
          task_id: opts.task ? resolveTaskId(opts.task) : undefined,
          plan_id: resolveOptionalId("plans", opts.plan),
          run_id: resolveOptionalId("task_runs", opts.run),
          agent_id: opts.agent,
          status: opts.status,
          include_completed: Boolean(opts.all),
          limit: Number(opts.limit),
        });
        if (opts.json || program.opts().json) { output(sessions, true); return; }
        if (sessions.length === 0) { console.log(chalk.dim("No focus sessions.")); return; }
        for (const session of sessions) {
          console.log(`${session.id.slice(0, 8)} ${session.status.padEnd(9)} ${String(session.actual_minutes).padStart(3)}m ${session.title || session.task_id?.slice(0, 8) || "(unlinked)"}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  time
    .command("idle")
    .description("Show active focus sessions that need an idle prompt")
    .option("--agent <id>", "Filter by agent")
    .option("--now <iso>", "Reference time")
    .option("-j, --json", "Output JSON")
    .action((opts) => {
      try {
        const prompts = getIdleFocusSessionPrompts({ agent_id: opts.agent, now: opts.now });
        if (opts.json || program.opts().json) { output(prompts, true); return; }
        if (prompts.length === 0) { console.log(chalk.dim("No idle focus sessions.")); return; }
        for (const prompt of prompts) console.log(chalk.yellow(prompt.message));
      } catch (e) {
        handleError(e);
      }
    });

  time
    .command("report")
    .description("Report local actual time against estimates")
    .option("--project <id>", "Filter by project")
    .option("--plan <id>", "Filter by plan")
    .option("--agent <id>", "Filter by agent")
    .option("--since <iso>", "Only tasks updated or completed since this date")
    .option("--include-open", "Include open tasks")
    .option("-j, --json", "Output JSON")
    .action((opts) => {
      try {
        const report = getTimeReport({
          project_id: resolveProjectOption(opts.project),
          plan_id: resolveOptionalId("plans", opts.plan),
          agent_id: opts.agent,
          since: opts.since,
          include_open: Boolean(opts.includeOpen),
        });
        if (opts.json || program.opts().json) { output(report, true); return; }
        if (report.length === 0) { console.log(chalk.dim("No time report entries.")); return; }
        for (const row of report) {
          const diff = row.estimated_minutes != null && row.actual_minutes != null ? row.actual_minutes - row.estimated_minutes : null;
          const suffix = diff == null ? "" : ` (${diff >= 0 ? "+" : ""}${diff}m)`;
          console.log(`${row.task_id.slice(0, 8)} ${row.title}: estimated ${row.estimated_minutes ?? "?"}m, actual ${row.actual_minutes ?? 0}m${suffix}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  const fields = program
    .command("fields")
    .description("Manage local labels, priority, severity, owner, area, and custom fields");

  fields
    .command("show <task-id>")
    .description("Show local fields for a task")
    .option("-j, --json", "Output as JSON")
    .action((taskId: string, opts) => {
      const globalOpts = program.opts();
      try {
        const payload = getTaskLocalFields(resolveTaskId(taskId));
        if (opts.json || globalOpts.json) { output(payload, true); return; }
        console.log(chalk.bold(`Fields for ${taskId}`));
        console.log(`  labels: ${payload.labels.join(", ") || "-"}`);
        console.log(`  priority: ${payload.priority}`);
        console.log(`  severity: ${payload.severity || "-"}`);
        console.log(`  owner: ${payload.owner || "-"}`);
        console.log(`  area: ${payload.area || "-"}`);
        if (Object.keys(payload.custom).length) console.log(`  custom: ${JSON.stringify(payload.custom)}`);
      } catch (e) {
        handleError(e);
      }
    });

  fields
    .command("set <task-id>")
    .description("Set local fields for a task")
    .option("--labels <labels>", "Comma-separated labels")
    .option("--priority <priority>", "Priority: low, medium, high, critical")
    .option("--severity <severity>", "Local severity, for example s0, s1, s2")
    .option("--owner <owner>", "Local owner or responsible agent")
    .option("--area <area>", "Local area or component")
    .option("--custom <json>", "Custom fields as a JSON object")
    .option("--field <pairs...>", "Custom key=value pairs")
    .option("--replace-custom", "Replace custom fields instead of merging")
    .option("-j, --json", "Output as JSON")
    .action((taskId: string, opts) => {
      const globalOpts = program.opts();
      try {
        const custom = mergeCustomFields(
          parseJsonObjectOption(opts.custom, "--custom"),
          parseFieldPairs(opts.field),
        );
        const input: SetTaskLocalFieldsInput = {
          labels: parseCsvOption(opts.labels),
          priority: parsePriority(opts.priority),
          severity: opts.severity,
          owner: opts.owner,
          area: opts.area,
          custom,
          merge_custom: opts.replaceCustom ? false : undefined,
        };
        const task = setTaskLocalFields(resolveTaskId(taskId), input);
        const payload = { task, fields: getTaskLocalFields(task.id) };
        if (opts.json || globalOpts.json) { output(payload, true); return; }
        console.log(chalk.green(`Updated fields for ${task.short_id || task.id.slice(0, 8)}.`));
      } catch (e) {
        handleError(e);
      }
    });

  fields
    .command("query")
    .description("Query tasks by local fields")
    .option("--labels <labels>", "Comma-separated labels all matching tasks must have")
    .option("--priority <priority>", "Priority: low, medium, high, critical")
    .option("--severity <severity>", "Local severity")
    .option("--owner <owner>", "Local owner or responsible agent")
    .option("--area <area>", "Local area or component")
    .option("--custom <json>", "Custom field query as a JSON object")
    .option("--field <pairs...>", "Custom key=value pairs")
    .option("--limit <n>", "Maximum tasks to return", "100")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      const globalOpts = program.opts();
      try {
        const query: LocalTaskFieldQuery = {
          labels: parseCsvOption(opts.labels),
          priority: parsePriority(opts.priority),
          severity: opts.severity,
          owner: opts.owner,
          area: opts.area,
          custom: mergeCustomFields(
            parseJsonObjectOption(opts.custom, "--custom"),
            parseFieldPairs(opts.field),
          ),
          limit: Number(opts.limit),
        };
        const tasks = queryTasksByLocalFields(query);
        if (opts.json || globalOpts.json) { output({ tasks, count: tasks.length }, true); return; }
        if (tasks.length === 0) {
          console.log(chalk.dim("No matching tasks."));
          return;
        }
        for (const task of tasks) console.log(formatTaskLine(task));
      } catch (e) {
        handleError(e);
      }
    });

  const workflow = program
    .command("workflow")
    .description("Manage local project workflow states");

  workflow
    .command("states")
    .description("List local workflow states")
    .option("--project-path <path>", "Project path override for workflow configuration")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      const globalOpts = program.opts();
      try {
        const states = listWorkflowStates(opts.projectPath || globalOpts.project || process.cwd());
        if (opts.json || globalOpts.json) { output({ states, local_only: true }, true); return; }
        console.log(renderWorkflowStatesMarkdown(states));
      } catch (e) {
        handleError(e);
      }
    });

  workflow
    .command("set <task-id> <state>")
    .description("Set a task's local workflow state")
    .option("--actor <agent>", "Agent or user changing the state")
    .option("--project-path <path>", "Project path override for workflow configuration")
    .option("--force", "Bypass configured transition guards")
    .option("-j, --json", "Output as JSON")
    .action((taskId: string, state: string, opts) => {
      const globalOpts = program.opts();
      try {
        const result = setTaskWorkflowState(resolveTaskId(taskId), state, {
          actor: opts.actor || globalOpts.agent,
          project_path: opts.projectPath || globalOpts.project || process.cwd(),
          force: Boolean(opts.force),
        });
        if (opts.json || globalOpts.json) { output(result, true); return; }
        console.log(chalk.green(`Moved ${result.task.short_id || result.task.id.slice(0, 8)} to ${result.workflow_state.name}.`));
      } catch (e) {
        handleError(e);
      }
    });

  workflow
    .command("tasks <state>")
    .description("List tasks by local workflow state")
    .option("--project <id>", "Project filter")
    .option("--task-list <id>", "Task list filter")
    .option("--project-path <path>", "Project path override for workflow configuration")
    .option("--limit <n>", "Maximum tasks to return", "100")
    .option("-j, --json", "Output as JSON")
    .action((state: string, opts) => {
      const globalOpts = program.opts();
      try {
        const result = queryTasksByWorkflowState({
          state,
          project_id: resolveProjectOption(opts.project),
          task_list_id: opts.taskList,
          project_path: opts.projectPath || globalOpts.project || process.cwd(),
          limit: Number(opts.limit),
        });
        if (opts.json || globalOpts.json) { output(result, true); return; }
        if (result.tasks.length === 0) {
          console.log(chalk.dim("No matching tasks."));
          return;
        }
        for (const task of result.tasks) console.log(formatTaskLine(task));
      } catch (e) {
        handleError(e);
      }
    });

  workflow
    .command("migrate")
    .description("Backfill local workflow state metadata from canonical task statuses")
    .option("--apply", "Write migration metadata")
    .option("--project <id>", "Project filter")
    .option("--task-list <id>", "Task list filter")
    .option("--project-path <path>", "Project path override for workflow configuration")
    .option("--limit <n>", "Maximum tasks to inspect", "10000")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      const globalOpts = program.opts();
      try {
        const report = migrateWorkflowStates({
          apply: Boolean(opts.apply),
          project_id: resolveProjectOption(opts.project),
          task_list_id: opts.taskList,
          project_path: opts.projectPath || globalOpts.project || process.cwd(),
          limit: Number(opts.limit),
        });
        if (opts.json || globalOpts.json) { output(report, true); return; }
        console.log(`${report.applied ? "Migrated" : "Would migrate"} ${report.applied ? report.migrated_count : report.pending_count} tasks.`);
      } catch (e) {
        handleError(e);
      }
    });

  const dedupe = program
    .command("dedupe")
    .description("Find and merge likely duplicate local tasks");

  dedupe
    .command("scan")
    .description("Scan local tasks for likely duplicates")
    .option("--threshold <n>", "Minimum duplicate score from 0 to 1", "0.74")
    .option("--limit <n>", "Maximum tasks to compare", "1000")
    .option("--include-archived", "Include archived tasks")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      const globalOpts = program.opts();
      try {
        const candidates = findDuplicateTasks({
          threshold: Number(opts.threshold),
          limit: Number(opts.limit),
          include_archived: Boolean(opts.includeArchived),
        });
        if (opts.json || globalOpts.json) { output({ candidates, count: candidates.length }, true); return; }
        if (candidates.length === 0) {
          console.log(chalk.dim("No duplicate candidates."));
          return;
        }
        for (const candidate of candidates) {
          const primary = candidate.primary_task.short_id || candidate.primary_task.id.slice(0, 8);
          const duplicate = candidate.duplicate_task.short_id || candidate.duplicate_task.id.slice(0, 8);
          console.log(`${chalk.cyan(primary)} <- ${chalk.yellow(duplicate)} ${candidate.score.toFixed(2)} ${candidate.reasons.join(", ")}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  dedupe
    .command("merge <primary-task-id> <duplicate-task-id>")
    .description("Merge a duplicate task into a primary task and archive the duplicate")
    .option("--agent <agent>", "Agent ID recording the merge")
    .option("--reason <reason>", "Human-readable merge reason")
    .option("-j, --json", "Output as JSON")
    .action((primaryTaskId: string, duplicateTaskId: string, opts) => {
      const globalOpts = program.opts();
      try {
        const result = mergeDuplicateTask({
          primary_task_id: resolveTaskId(primaryTaskId),
          duplicate_task_id: resolveTaskId(duplicateTaskId),
          agent_id: opts.agent || globalOpts.agent,
          reason: opts.reason,
        });
        if (opts.json || globalOpts.json) { output(result, true); return; }
        const primary = result.primary_task.short_id || result.primary_task.id.slice(0, 8);
        const duplicate = result.archived_duplicate.short_id || result.archived_duplicate.id.slice(0, 8);
        console.log(chalk.green(`Merged ${duplicate} into ${primary}.`));
      } catch (e) {
        handleError(e);
      }
    });

  const issues = program
    .command("issues")
    .description("Import external issue data into local tasks");

  issues
    .command("import [text]")
    .description("Dry-run or apply local imports from GitHub, Linear, Jira, or plain URL issue data")
    .option("--file <path>", "Read issue data from a JSON, Markdown, or text file")
    .option("--url <url>", "Source issue URL")
    .option("--provider <provider>", "github, linear, jira, or url")
    .option("--project <id>", "Project ID for created tasks")
    .option("--list <id>", "Task list ID for created tasks")
    .option("--priority <priority>", "Default priority for records without explicit priority", "medium")
    .option("--apply", "Create local tasks; default is dry-run preview")
    .option("--allow-network", "Allow explicit provider CLI/API fetches when supported")
    .option("--no-inbox", "Do not create linked inbox evidence for applied imports")
    .option("--no-dedupe", "Do not skip records that match existing source metadata")
    .option("-j, --json", "Output as JSON")
    .action(async (text: string | undefined, opts) => {
      const globalOpts = program.opts();
      try {
        const { importExternalIssues } = await import("../../lib/external-issue-importers.js");
        let body = text || "";
        if (opts.file) body = readFileSync(opts.file, "utf-8");
        if (!body && !opts.url && !process.stdin.isTTY) body = await Bun.stdin.text();
        if (!body.trim() && !opts.url) {
          console.error(chalk.red("Provide text, --file, --url, or stdin input."));
          process.exit(1);
        }
        const report = importExternalIssues({
          provider: opts.provider,
          text: body || undefined,
          source_url: opts.url,
          source_name: opts.file || opts.url,
          project_id: resolveProjectOption(opts.project) || autoProject(globalOpts) || undefined,
          task_list_id: opts.list,
          agent_id: globalOpts.agent,
          default_priority: parsePriority(opts.priority) || "medium",
          apply: Boolean(opts.apply),
          allow_network: Boolean(opts.allowNetwork),
          create_inbox: opts.inbox,
          dedupe: opts.dedupe,
        });
        if (opts.json || globalOpts.json) { output(report, true); return; }
        const mode = report.dry_run ? "Previewed" : "Imported";
        console.log(chalk.green(`${mode} ${report.issues.length} external issue${report.issues.length === 1 ? "" : "s"}.`));
        if (report.created_tasks.length > 0) {
          for (const task of report.created_tasks) console.log(`  ${chalk.cyan(task.short_id || task.id.slice(0, 8))} ${task.title}`);
        }
        if (report.existing_matches.length > 0) console.log(chalk.yellow(`  skipped existing: ${report.existing_matches.length}`));
        if (report.warnings.length > 0) for (const warning of report.warnings) console.log(chalk.yellow(`  ${warning}`));
      } catch (e) {
        handleError(e);
      }
    });

  issues
    .command("report [json]")
    .description("Dry-run or apply testers.issue_report.v1 payloads into local tasks")
    .option("--file <path>", "Read a tester issue report JSON object, array, or { reports: [] } bundle")
    .option("--project <id>", "Project ID for created tasks")
    .option("--list <id>", "Task list ID for created tasks")
    .option("--priority <priority>", "Default priority when report severity is missing", "medium")
    .option("--assign <agent>", "Assign created or updated tasks to an agent")
    .option("--apply", "Create or update local tasks; default is dry-run preview")
    .option("--no-update-existing", "Match existing tasks without updating them")
    .option("-j, --json", "Output as JSON")
    .action(async (jsonText: string | undefined, opts) => {
      const globalOpts = program.opts();
      try {
        const {
          readTesterIssueReportsPayload,
          upsertTesterIssueReports,
        } = await import("../../lib/tester-issue-reports.js");
        let body = jsonText || "";
        if (opts.file) body = readFileSync(opts.file, "utf-8");
        if (!body && !process.stdin.isTTY) body = await Bun.stdin.text();
        if (!body.trim()) {
          console.error(chalk.red("Provide a tester issue report JSON payload, --file, or stdin input."));
          process.exit(1);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          console.error(chalk.red("Tester issue report payload must be valid JSON."));
          process.exit(1);
        }

        const result = upsertTesterIssueReports({
          reports: readTesterIssueReportsPayload(parsed),
          project_id: resolveProjectOption(opts.project) || autoProject(globalOpts) || undefined,
          task_list_id: opts.list,
          agent_id: globalOpts.agent,
          assigned_to: opts.assign,
          default_priority: parsePriority(opts.priority) || "medium",
          apply: Boolean(opts.apply),
          update_existing: opts.updateExisting,
        });
        if (opts.json || globalOpts.json) { output(result, true); return; }

        const mode = result.dry_run ? "Previewed" : "Applied";
        console.log(chalk.green(`${mode} ${result.summary.total} tester issue report${result.summary.total === 1 ? "" : "s"}.`));
        for (const item of result.results) {
          const taskRef = item.task ? item.task.short_id || item.task.id.slice(0, 8) : "(no task)";
          console.log(`  ${chalk.cyan(item.action.padEnd(9))} ${taskRef} ${chalk.dim(item.fingerprint)} ${item.report.title}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  const inbox = program
    .command("inbox")
    .description("Capture local inbox items from pasted errors, CI logs, git context, files, or GitHub issue URLs");

  inbox
    .command("add [text]")
    .description("Create a local inbox item and linked task from text, stdin, or a file")
    .option("--file <path>", "Read captured context from a file")
    .option("--source-type <type>", "pasted_error, ci_log, git_context, github_issue, file, or other")
    .option("--source-name <name>", "Human-readable source name")
    .option("--source-url <url>", "Source URL, including GitHub issue URLs")
    .option("--title <title>", "Task/inbox title")
    .option("--priority <priority>", "Task priority")
    .option("--tags <tags>", "Comma-separated extra tags")
    .option("--metadata <json>", "Additional JSON metadata")
    .option("--no-task", "Only store inbox item; do not create a linked task")
    .option("-j, --json", "Output as JSON")
    .action(async (text: string | undefined, opts) => {
      const globalOpts = program.opts();
      const { readFileSync } = await import("node:fs");
      const { createInboxItem } = await import("../../db/inbox.js");
      let body = text || "";
      if (opts.file) body = readFileSync(opts.file, "utf-8");
      if (!body && !process.stdin.isTTY) body = await Bun.stdin.text();
      if (!body.trim()) {
        console.error(chalk.red("Provide text, --file, or stdin input."));
        process.exit(1);
      }
      const result = createInboxItem({
        title: opts.title,
        body,
        source_type: opts.sourceType,
        source_name: opts.sourceName || opts.file,
        source_url: opts.sourceUrl,
        metadata: parseJsonObjectOption(opts.metadata, "--metadata"),
        project_id: autoProject(globalOpts) || undefined,
        priority: opts.priority,
        tags: opts.tags ? String(opts.tags).split(",").map((tag: string) => tag.trim()).filter(Boolean) : undefined,
        create_task: opts.task,
      });
      if (opts.json || globalOpts.json) { output(result, true); return; }
      const id = result.item.id.slice(0, 8);
      const duplicate = result.duplicate ? chalk.yellow("duplicate ") : "";
      console.log(chalk.green(`${duplicate}Inbox item ${id}: ${result.item.title}`));
      if (result.task) console.log(chalk.cyan(`  Task: ${result.task.short_id || result.task.id.slice(0, 8)}`));
    });

  inbox
    .command("git")
    .description("Capture local git status and optional diff/stat context into the inbox")
    .option("--diff", "Include git diff --stat and short diff context")
    .option("--title <title>", "Task/inbox title")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const { execSync } = await import("node:child_process");
      const { createInboxItem } = await import("../../db/inbox.js");
      const status = execSync("git status --short", { encoding: "utf-8" });
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
      const diffStat = opts.diff ? execSync("git diff --stat", { encoding: "utf-8" }) : "";
      const diff = opts.diff ? execSync("git diff -- src README.md docs package.json | sed -n '1,220p'", { encoding: "utf-8", shell: "/bin/bash" }) : "";
      const body = [`branch: ${branch}`, "status:", status || "(clean)", diffStat ? `diff stat:\n${diffStat}` : null, diff ? `diff:\n${diff}` : null].filter(Boolean).join("\n\n");
      const result = createInboxItem({
        title: opts.title || `Git context: ${branch}`,
        body,
        source_type: "git_context",
        source_name: branch,
        project_id: autoProject(globalOpts) || undefined,
        priority: "medium",
        tags: ["git"],
      });
      if (opts.json || globalOpts.json) { output(result, true); return; }
      console.log(chalk.green(`Inbox item ${result.item.id.slice(0, 8)}: ${result.item.title}`));
      if (result.task) console.log(chalk.cyan(`  Task: ${result.task.short_id || result.task.id.slice(0, 8)}`));
    });

  inbox
    .command("parse [text]")
    .description("Preview or apply deterministic local natural-language task intake")
    .option("--file <path>", "Read natural-language input from a file")
    .option("--priority <priority>", "Default priority for parsed tasks", "medium")
    .option("--project <id>", "Project ID for applied tasks")
    .option("--list <id>", "Task list ID for applied tasks")
    .option("--reference-date <iso>", "Reference date for due today/tomorrow/next week")
    .option("--apply", "Create parsed tasks; default is dry-run preview")
    .option("-j, --json", "Output as JSON")
    .action(async (text: string | undefined, opts) => {
      const globalOpts = program.opts();
      const { readFileSync } = await import("node:fs");
      const { previewNaturalLanguageIntake } = await import("../../lib/natural-language-intake.js");
      let body = text || "";
      if (opts.file) body = readFileSync(opts.file, "utf-8");
      if (!body && !process.stdin.isTTY) body = await Bun.stdin.text();
      if (!body.trim()) {
        console.error(chalk.red("Provide text, --file, or stdin input."));
        process.exit(1);
      }
      const result = previewNaturalLanguageIntake({
        text: body,
        project_id: opts.project || autoProject(globalOpts) || undefined,
        task_list_id: opts.list,
        default_priority: opts.priority,
        reference_date: opts.referenceDate,
        apply: Boolean(opts.apply),
      });
      if (opts.json || globalOpts.json) { output(result, true); return; }
      console.log(result.dry_run ? chalk.yellow(`Dry-run: ${result.tasks.length} task(s) parsed.`) : chalk.green(`Created ${result.created_tasks.length} task(s).`));
      for (const task of result.tasks) console.log(`  ${chalk.cyan(task.priority.padEnd(8))} ${task.title}`);
      for (const warning of result.warnings) console.log(chalk.yellow(`  ${warning}`));
    });

  inbox
    .command("list")
    .description("List local inbox items")
    .option("--status <status>", "new, triaged, or ignored")
    .option("--source-type <type>", "Filter by source type")
    .option("--limit <n>", "Max rows", "50")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const globalOpts = program.opts();
      const { listInboxItems } = await import("../../db/inbox.js");
      const items = listInboxItems({ status: opts.status, source_type: opts.sourceType, limit: Number.parseInt(opts.limit, 10) });
      if (opts.json || globalOpts.json) { output(items, true); return; }
      if (items.length === 0) {
        console.log(chalk.dim("No inbox items."));
        return;
      }
      for (const item of items) {
        console.log(`${chalk.cyan(item.id.slice(0, 8))} ${item.source_type.padEnd(12)} ${item.title}`);
      }
    });

  inbox
    .command("show <id>")
    .description("Show one inbox item")
    .option("-j, --json", "Output as JSON")
    .action(async (id: string, opts) => {
      const globalOpts = program.opts();
      const { getInboxItem } = await import("../../db/inbox.js");
      const item = getInboxItem(id);
      if (!item) {
        console.error(chalk.red(`Inbox item not found: ${id}`));
        process.exit(1);
      }
      if (opts.json || globalOpts.json) { output(item, true); return; }
      console.log(chalk.bold(`${item.id.slice(0, 8)} ${item.title}`));
      console.log(chalk.dim(`${item.source_type} ${item.source_name || ""}`.trim()));
      if (item.task_id) console.log(`Task: ${item.task_id}`);
      if (item.body) console.log(`\n${item.body}`);
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
