// @ts-nocheck
/**
 * Task auto tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";

interface TaskAutoContext {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table?: string) => string;
  formatError: (error: unknown) => string;
  formatTask: (task: Task) => string;
  formatTaskDetail: (task: Task, maxDescriptionChars?: number) => string;
  getAgentFocus: (agentId: string) => { agent_id: string; project_id?: string } | undefined;
}

export function registerTaskAutoTools(server: McpServer, ctx: TaskAutoContext) {
  const { shouldRegisterTool, resolveId, formatError, formatTask } = ctx;

  // === AUTO ARCHIVE / CLEANUP ===

  if (shouldRegisterTool("archive_completed")) {
    server.tool(
      "archive_completed",
      "Auto-archive completed tasks older than the threshold (default 7 days). Returns count.",
      {
        days: z.number().optional().describe("Archive tasks completed more than N days ago (default: 7)"),
        project_id: z.string().optional().describe("Scope to a project"),
      },
      async ({ days = 7, project_id }) => {
        try {
          const { archiveCompletedTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const count = archiveCompletedTasks(days, resolvedProjectId);
          return { content: [{ type: "text" as const, text: `Archived ${count} completed task(s) older than ${days} days.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("unarchive_task")) {
    server.tool(
      "unarchive_task",
      "Restore an archived task back to pending.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const { unarchiveTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          unarchiveTask(resolveId(task_id));
          return { content: [{ type: "text" as const, text: `Task ${task_id.slice(0,8)} restored from archive.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_archived_tasks")) {
    server.tool(
      "get_archived_tasks",
      "List archived tasks.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        limit: z.number().optional().describe("Max results (default: 50)"),
      },
      async ({ project_id, limit }) => {
        try {
          const { getArchivedTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const tasks = getArchivedTasks({ project_id: resolvedProjectId, limit: limit || 50 });
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "No archived tasks." }] };
          const lines = tasks.map((t: any) => `${(t.short_id || t.id.slice(0,8))} ${t.title} archived ${t.archived_at}`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("auto_assign_task")) {
    server.tool(
      "auto_assign_task",
      "Automatically assign a task to the best-fit agent based on capabilities, current load, and focus mode.",
      {
        task_id: z.string().describe("Task ID"),
      },
      async ({ task_id }) => {
        try {
          const { autoAssign } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const resolvedId = resolveId(task_id);
          const assignment = autoAssign(resolvedId);
          if (!assignment) return { content: [{ type: "text" as const, text: "No suitable agent found for this task." }] };
          const { updateTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          updateTask(resolvedId, { assigned_to: assignment.agent_id });
          return { content: [{ type: "text" as const, text: `Task ${task_id.slice(0,8)} assigned to ${assignment.agent_name} (score: ${assignment.score.toFixed(2)})` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_my_workload")) {
    server.tool(
      "get_my_workload",
      "Get current workload stats for an agent: in-progress count, tasks due soon, blocked tasks.",
      {
        agent_id: z.string().optional().describe("Agent ID (defaults to context agent)"),
      },
      async ({ agent_id }) => {
        try {
          const { getAgentWorkload } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const focus = ctx.getAgentFocus(agent_id || "");
          const effectiveAgentId = focus ? focus.agent_id : agent_id || "";
          const workload = getAgentWorkload(effectiveAgentId);
          const lines = [
            `Agent: ${effectiveAgentId}`,
            `In Progress: ${workload.in_progress}`,
            `Pending: ${workload.pending}`,
            `Completed (recent): ${workload.completed_recent}`,
            `Due Soon: ${workload.due_soon}`,
            `Blocked: ${workload.blocked}`,
          ];
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("rebalance_workload")) {
    server.tool(
      "rebalance_workload",
      "Attempt to rebalance task assignments across agents by reassigning from overloaded to underloaded agents.",
      {
        project_id: z.string().optional().describe("Scope to a project"),
        max_per_agent: z.number().optional().describe("Max tasks per agent (default: 5)"),
      },
      async ({ project_id, max_per_agent }) => {
        try {
          const { rebalanceWorkload } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const result = rebalanceWorkload({ project_id: resolvedProjectId, max_per_agent: max_per_agent || 5 });
          return { content: [{ type: "text" as const, text: `Rebalanced: moved ${result.moved} task(s), ${result.skipped} skipped.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("notify_upcoming_deadlines")) {
    server.tool(
      "notify_upcoming_deadlines",
      "Get tasks with deadlines approaching within the threshold. Good for reminders.",
      {
        hours: z.number().optional().describe("Hours until deadline (default: 24)"),
        project_id: z.string().optional().describe("Filter by project"),
        agent_id: z.string().optional().describe("Filter by assignee"),
      },
      async ({ hours = 24, project_id, agent_id }) => {
        try {
          const { notifyUpcomingDeadlines } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const resolvedAgentId = agent_id ? resolveId(agent_id, "agents") : undefined;
          const tasks = notifyUpcomingDeadlines({ hours, project_id: resolvedProjectId, agent_id: resolvedAgentId });
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "No deadlines approaching." }] };
          const lines = tasks.map((t: any) => `${(t.short_id || t.id.slice(0,8))} ${t.title} due ${t.deadline}`);
          return { content: [{ type: "text" as const, text: `${tasks.length} task(s) due within ${hours}h:\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_stale_tasks")) {
    server.tool(
      "get_stale_tasks",
      "Get tasks that haven't been updated in a given time window (excluding completed/cancelled).",
      {
        hours: z.number().optional().describe("Hours since last update (default: 48)"),
        project_id: z.string().optional().describe("Filter by project"),
      },
      async ({ hours = 48, project_id }) => {
        try {
          const { getStaleTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const tasks = getStaleTasks({ hours, project_id: resolvedProjectId });
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "No stale tasks." }] };
          const lines = tasks.map((t: any) => `${(t.short_id || t.id.slice(0,8))} [${t.status}] ${t.title} — last updated ${t.updated_at}`);
          return { content: [{ type: "text" as const, text: `${tasks.length} stale task(s):\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === BLOCKERS ===

  if (shouldRegisterTool("get_blocked_tasks")) {
    server.tool(
      "get_blocked_tasks",
      "Get tasks that are blocked by incomplete dependencies.",
      {
        project_id: z.string().optional().describe("Filter by project"),
      },
      async ({ project_id }) => {
        try {
          const { getBlockedTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const tasks = getBlockedTasks(resolvedProjectId);
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "No blocked tasks." }] };
          const lines = tasks.map((t: any) => `${(t.short_id || t.id.slice(0,8))} [${t.status}] ${t.title} — blocked by ${(t.blocked_by || []).map((b: string) => b.slice(0,8)).join(", ")}`);
          return { content: [{ type: "text" as const, text: `${tasks.length} blocked task(s):\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_blocking_tasks")) {
    server.tool(
      "get_blocking_tasks",
      "Get tasks that are blocking other tasks (incomplete but others depend on them).",
      {
        project_id: z.string().optional().describe("Filter by project"),
      },
      async ({ project_id }) => {
        try {
          const { getBlockingTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const tasks = getBlockingTasks(resolvedProjectId);
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "No tasks blocking others." }] };
          const lines = tasks.map((t: any) => `${(t.short_id || t.id.slice(0,8))} [${t.status}] ${t.title} — blocking ${t.blocking_count} task(s)`);
          return { content: [{ type: "text" as const, text: `${tasks.length} blocking task(s):\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === HEALTH ===

  if (shouldRegisterTool("get_health")) {
    server.tool(
      "get_health",
      "Get system health: task counts by status, active agents, project summary.",
      async () => {
        try {
          const { listTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const { listProjects } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const { listAgents } = require("../../db/agents.js") as typeof import("../../db/agents.js");

          const [pending, inProgress, completed, cancelled] = await Promise.all([
            Promise.resolve(listTasks({ status: "pending", limit: 1 }, undefined)),
            Promise.resolve(listTasks({ status: "in_progress", limit: 1 }, undefined)),
            Promise.resolve(listTasks({ status: "completed", limit: 1 }, undefined)),
            Promise.resolve(listTasks({ status: "cancelled", limit: 1 }, undefined)),
          ]);

          const projects = listProjects({ limit: 100 });
          const agents = listAgents({ limit: 100 });

          const lines = [
            `=== System Health ===`,
            `Tasks: ${pending.total} pending | ${inProgress.total} in progress | ${completed.total} completed | ${cancelled.total} cancelled`,
            `Projects: ${projects.length} total`,
            `Agents: ${agents.length} registered`,
          ];
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
