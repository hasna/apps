// @ts-nocheck
/**
 * Task auto tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";
import {
  getTodosCloudClient,
  cloudGetStats,
  cloudCountTasks,
  cloudListProjects,
  cloudListAgents,
  cloudListTasks,
  cloudStaleTasks,
  cloudEscalatedTasks,
  cloudAllDependencies,
  cloudBlockingDepsMap,
  cloudGetTasksByIds,
  cloudGetIntegrityReport,
  cloudGetTask,
  cloudUpdateTask,
} from "../../cli/cloud-router.js";
import { assignedToAliasSet, getDatabase } from "../../db/database.js";

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
          // http authority routing: read the completed set from GET /v1/tasks
          // (include_archived=false so already-archived rows are not re-stamped)
          // and stamp archived_at with PATCH /v1/tasks/:id.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            const stampedAt = new Date().toISOString();
            const candidates = (await cloudListTasks(cloud, {
              status: "completed",
              include_archived: false,
              ...(project_id ? { project_id } : {}),
            } as never)).filter((t) => (t.completed_at ?? t.updated_at ?? "") < cutoff);
            let archived = 0;
            for (const t of candidates) {
              await cloudUpdateTask(cloud, t.id, { archived_at: stampedAt, version: t.version });
              archived++;
            }
            return { content: [{ type: "text" as const, text: `Archived ${archived} completed task(s) older than ${days} days.` }] };
          }
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
          // http authority routing: PATCH /v1/tasks/:id clearing archived_at
          // (parity with the local UPDATE ... SET archived_at = NULL).
          const cloud = getTodosCloudClient();
          if (cloud) {
            const current = await cloudGetTask(cloud, task_id);
            if (!current) throw new Error(`Task not found: ${task_id}`);
            await cloudUpdateTask(cloud, current.id, { archived_at: null, version: current.version });
            return { content: [{ type: "text" as const, text: `Task ${task_id.slice(0, 8)} restored from archive.` }] };
          }
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
          // http authority routing: GET /v1/tasks?include_archived=true, then
          // keep only the rows that actually carry archived_at.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const remote = (await cloudListTasks(cloud, {
              include_archived: true,
              ...(project_id ? { project_id } : {}),
            } as never))
              .filter((t) => t.archived_at)
              .sort((a, b) => (b.archived_at ?? "").localeCompare(a.archived_at ?? ""))
              .slice(0, limit || 50);
            if (remote.length === 0) return { content: [{ type: "text" as const, text: "No archived tasks." }] };
            const remoteLines = remote.map((t) => `${(t.short_id || t.id.slice(0, 8))} ${t.title} archived ${t.archived_at}`);
            return { content: [{ type: "text" as const, text: remoteLines.join("\n") }] };
          }
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
          const resolvedId = resolveId(task_id);
          const { autoAssignTask } = require("../../lib/auto-assign.js") as typeof import("../../lib/auto-assign.js");
          const assignment = await autoAssignTask(resolvedId);
          if (!assignment.assigned_to) return { content: [{ type: "text" as const, text: "No suitable agent found for this task." }] };
          const reason = assignment.reason ? ` — ${assignment.reason}` : "";
          return { content: [{ type: "text" as const, text: `Task ${task_id.slice(0,8)} assigned to ${assignment.agent_name || assignment.assigned_to} via ${assignment.method}${reason}` }] };
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
          const focus = ctx.getAgentFocus(agent_id || "");
          const effectiveAgentId = focus ? focus.agent_id : agent_id || "";
          if (!effectiveAgentId) {
            return { content: [{ type: "text" as const, text: "No agent_id provided and no agent focus is active." }], isError: true };
          }
          // http authority routing: GET /v1/tasks?assigned_to=… plus
          // GET /v1/dependencies for the blocked count. Reading the workload
          // locally reported 0 on any station whose tasks live in the cloud.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const remoteAssigned = await cloudListTasks(cloud, { assigned_to: effectiveAgentId, limit: 500 } as never);
            const remoteNow = Date.now();
            const remoteDueSoon = remoteNow + 24 * 60 * 60 * 1000;
            const remoteBlocked = await cloudBlockingDepsMap(cloud, remoteAssigned.filter((t) => !["completed", "cancelled", "failed"].includes(t.status)));
            const remoteLines = [
              `Agent: ${effectiveAgentId}`,
              `In Progress: ${remoteAssigned.filter((t) => t.status === "in_progress").length}`,
              `Pending: ${remoteAssigned.filter((t) => t.status === "pending").length}`,
              `Completed (recent): ${remoteAssigned.filter((t) => t.status === "completed" && t.completed_at && remoteNow - new Date(t.completed_at).getTime() <= 7 * 24 * 60 * 60 * 1000).length}`,
              `Due Soon: ${remoteAssigned.filter((t) => t.due_at && new Date(t.due_at).getTime() <= remoteDueSoon && new Date(t.due_at).getTime() >= remoteNow && !["completed", "cancelled", "failed"].includes(t.status)).length}`,
              `Blocked: ${remoteBlocked.size}`,
            ];
            return { content: [{ type: "text" as const, text: remoteLines.join("\n") }] };
          }
          const { listTasks, getBlockedTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const assigned = listTasks({ assigned_to: effectiveAgentId, limit: 500 }, undefined) as Task[];
          const now = Date.now();
          const dueSoonCutoff = now + 24 * 60 * 60 * 1000;
          // Alias-resolved (task 84c77210): `getBlockedTasks` takes no agent
          // filter of its own, unlike `listTasks` above (fixed in #160) — see
          // database.ts for the root cause.
          const blockedAliases = assignedToAliasSet(getDatabase(), effectiveAgentId);
          const blocked = getBlockedTasks().filter((t: Task) => blockedAliases.has((t.assigned_to ?? "").toLowerCase()));
          const workload = {
            in_progress: assigned.filter(t => t.status === "in_progress").length,
            pending: assigned.filter(t => t.status === "pending").length,
            completed_recent: assigned.filter(t => t.status === "completed" && t.completed_at && now - new Date(t.completed_at).getTime() <= 7 * 24 * 60 * 60 * 1000).length,
            due_soon: assigned.filter(t => t.due_at && new Date(t.due_at).getTime() <= dueSoonCutoff && new Date(t.due_at).getTime() >= now && !["completed", "cancelled", "failed"].includes(t.status)).length,
            blocked: blocked.length,
          };
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
          // http authority routing: GET /v1/agents + GET /v1/tasks, then one
          // PATCH /v1/tasks/:id per move. The server resolves every alias form
          // of assigned_to, so the load map is keyed on the roster it returns.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const cap = max_per_agent || 5;
            const roster = (await cloudListAgents(cloud)).filter((a) => (a as { status?: string }).status !== "archived");
            if (roster.length === 0) return { content: [{ type: "text" as const, text: "No active agents available for rebalancing." }] };
            const active = (await cloudListTasks(cloud, {
              status: ["pending", "in_progress"],
              ...(project_id ? { project_id } : {}),
            } as never));
            const keyByAlias = new Map<string, string>();
            const ambiguous = new Set<string>();
            const index = (alias: string | undefined, agentId: string) => {
              if (!alias) return;
              const key = alias.toLowerCase();
              if (ambiguous.has(key)) return;
              const seen = keyByAlias.get(key);
              if (seen !== undefined && seen !== agentId) { keyByAlias.delete(key); ambiguous.add(key); return; }
              keyByAlias.set(key, agentId);
            };
            for (const agent of roster) { index(agent.id, agent.id); index(agent.name, agent.id); }
            const keyOf = (assignedTo: string | null | undefined) => (assignedTo ? keyByAlias.get(assignedTo.toLowerCase()) : undefined);
            const load = new Map(roster.map((a) => [a.id, active.filter((t) => keyOf(t.assigned_to) === a.id).length]));
            let moved = 0;
            let skipped = 0;
            for (const t of active.filter((t) => t.status === "pending" && keyOf(t.assigned_to) && (load.get(keyOf(t.assigned_to)!) ?? 0) > cap)) {
              const from = keyOf(t.assigned_to)!;
              const target = roster
                .filter((a) => a.id !== from)
                .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
              if (!target || (load.get(target.id) ?? 0) >= cap) { skipped++; continue; }
              await cloudUpdateTask(cloud, t.id, { assigned_to: target.id, version: t.version });
              load.set(from, (load.get(from) ?? 1) - 1);
              load.set(target.id, (load.get(target.id) ?? 0) + 1);
              moved++;
            }
            return { content: [{ type: "text" as const, text: `Rebalanced: moved ${moved} task(s), ${skipped} skipped.` }] };
          }
          const { listAgents } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const { listTasks, updateTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const limit = max_per_agent || 5;
          const agents = listAgents().filter((agent: any) => agent.status === "active");
          if (agents.length === 0) return { content: [{ type: "text" as const, text: "No active agents available for rebalancing." }] };
          const activeTasks = listTasks({ project_id: resolvedProjectId, status: ["pending", "in_progress"], limit: 1000 }, undefined) as Task[];
          // Alias-resolved (task 84c77210): `t.assigned_to` holds an agent id
          // from one write path and a resolved name from another — see
          // database.ts for the root cause. Keying `load` by whatever raw
          // string `t.assigned_to` holds (as this did before) silently
          // undercounted an overloaded agent's queue whenever some of its
          // tasks were recorded under the other form, so the rebalance loop
          // below never reassigned them: a load map that misses half an
          // agent's tasks does not fail loudly, it just never fires.
          // Built once from the already-fetched roster (roster has both id
          // and name), so this needs no per-task DB lookup.
          const agentKeyByAlias = new Map<string, string>();
          const ambiguousAgentAliases = new Set<string>();
          const indexAgentAlias = (alias: string, agentId: string): void => {
            const normalizedAlias = alias.toLowerCase();
            if (ambiguousAgentAliases.has(normalizedAlias)) return;
            const existingAgentId = agentKeyByAlias.get(normalizedAlias);
            if (existingAgentId !== undefined && existingAgentId !== agentId) {
              agentKeyByAlias.delete(normalizedAlias);
              ambiguousAgentAliases.add(normalizedAlias);
              return;
            }
            agentKeyByAlias.set(normalizedAlias, agentId);
          };
          for (const agent of agents) {
            indexAgentAlias(String(agent.id), agent.id);
            if (agent.name) indexAgentAlias(String(agent.name), agent.id);
          }
          // Case-insensitive legacy name collisions are not safe to resolve to
          // either agent. Leave those assignments untouched instead of choosing
          // whichever roster row happened to be indexed last.
          const canonicalAgentKey = (assignedTo: string | null | undefined): string | undefined =>
            assignedTo ? agentKeyByAlias.get(assignedTo.toLowerCase()) : undefined;

          const load = new Map(agents.map((agent: any) => [agent.id, activeTasks.filter(t => canonicalAgentKey(t.assigned_to) === agent.id).length]));
          let moved = 0;
          let skipped = 0;

          for (const task of activeTasks.filter(t => t.status === "pending" && canonicalAgentKey(t.assigned_to) && (load.get(canonicalAgentKey(t.assigned_to)!) ?? 0) > limit)) {
            const currentAgentKey = canonicalAgentKey(task.assigned_to)!;
            const target = agents
              .filter((agent: any) => agent.id !== currentAgentKey)
              .sort((a: any, b: any) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
            if (!target || (load.get(target.id) ?? 0) >= limit) {
              skipped++;
              continue;
            }
            updateTask(task.id, { assigned_to: target.id, version: task.version });
            load.set(currentAgentKey, (load.get(currentAgentKey) ?? 1) - 1);
            load.set(target.id, (load.get(target.id) ?? 0) + 1);
            moved++;
          }

          return { content: [{ type: "text" as const, text: `Rebalanced: moved ${moved} task(s), ${skipped} skipped.` }] };
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
          // http authority routing: GET /v1/tasks (server-side project/assignee
          // filters), deadline window applied to the shared rows.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const horizon = Date.now() + hours * 60 * 60 * 1000;
            const remote = (await cloudListTasks(cloud, {
              ...(project_id ? { project_id } : {}),
              ...(agent_id ? { assigned_to: agent_id } : {}),
            } as never))
              .filter((t) => t.due_at && !["completed", "cancelled", "failed"].includes(t.status)
                && new Date(t.due_at).getTime() <= horizon && new Date(t.due_at).getTime() >= Date.now())
              .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
            if (remote.length === 0) return { content: [{ type: "text" as const, text: "No deadlines approaching." }] };
            const remoteLines = remote.map((t) => `${(t.short_id || t.id.slice(0, 8))} ${t.title} due ${t.due_at}`);
            return { content: [{ type: "text" as const, text: `${remote.length} task(s) due within ${hours}h:\n${remoteLines.join("\n")}` }] };
          }
          const { notifyUpcomingDeadlines } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const resolvedAgentId = agent_id ? resolveId(agent_id, "agents") : undefined;
          const tasks = notifyUpcomingDeadlines({ hours, project_id: resolvedProjectId, agent_id: resolvedAgentId });
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "No deadlines approaching." }] };
          const lines = tasks.map((t: any) => `${(t.short_id || t.id.slice(0,8))} ${t.title} due ${t.due_at}`);
          return { content: [{ type: "text" as const, text: `${tasks.length} task(s) due within ${hours}h:\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_sla_breaches")) {
    server.tool(
      "get_sla_breaches",
      "List unfinished local tasks that are overdue or past their SLA minutes and should be escalated.",
      {
        project_id: z.string().optional().describe("Filter by project"),
        agent_id: z.string().optional().describe("Filter by assignee"),
        limit: z.number().optional().describe("Max results (default: 50)"),
      },
      async ({ project_id, agent_id, limit }) => {
        try {
          // http authority routing: the shared escalation computation
          // (GET /v1/tasks) instead of this machine's rows.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const remote = (await cloudEscalatedTasks(cloud, { project_id, agent_id })).slice(0, limit || 50);
            if (remote.length === 0) return { content: [{ type: "text" as const, text: "No SLA breaches or overdue tasks." }] };
            const remoteLines = remote.map((item) => `${item.task.short_id || item.task.id.slice(0, 8)} ${item.task.title} ${item.reasons.join(",")} breached ${item.breached_at}`);
            return { content: [{ type: "text" as const, text: `${remote.length} escalation(s):\n${remoteLines.join("\n")}` }] };
          }
          const { getEscalatedTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const resolvedAgentId = agent_id ? resolveId(agent_id, "agents") : undefined;
          const escalations = getEscalatedTasks({ project_id: resolvedProjectId, agent_id: resolvedAgentId }).slice(0, limit || 50);
          if (escalations.length === 0) return { content: [{ type: "text" as const, text: "No SLA breaches or overdue tasks." }] };
          const lines = escalations.map((item: any) => {
            const task = item.task;
            return `${task.short_id || task.id.slice(0, 8)} ${task.title} ${item.reasons.join(",")} breached ${item.breached_at}`;
          });
          return { content: [{ type: "text" as const, text: `${escalations.length} escalation(s):\n${lines.join("\n")}` }] };
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
        minutes: z.number().optional().describe("Minutes since last update; overrides hours when provided"),
        project_id: z.string().optional().describe("Filter by project"),
      },
      async ({ hours = 48, minutes, project_id }) => {
        try {
          // http authority routing: GET /v1/tasks?status=in_progress, staleness
          // applied to the shared rows (parity with the CLI `stale` verb).
          const cloud = getTodosCloudClient();
          if (cloud) {
            const remote = await cloudStaleTasks(cloud, minutes ?? hours * 60, (project_id ? { project_id } : {}) as never);
            if (remote.length === 0) return { content: [{ type: "text" as const, text: "No stale tasks." }] };
            const remoteLines = remote.map((t) => `${(t.short_id || t.id.slice(0, 8))} [${t.status}] ${t.title} — last updated ${t.updated_at}`);
            return { content: [{ type: "text" as const, text: `${remote.length} stale task(s):\n${remoteLines.join("\n")}` }] };
          }
          const { getStaleTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedProjectId = project_id ? resolveId(project_id, "projects") : undefined;
          const tasks = getStaleTasks({ hours, minutes, project_id: resolvedProjectId });
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
          // http authority routing: GET /v1/tasks + GET /v1/dependencies.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const candidates = (await cloudListTasks(cloud, (project_id ? { project_id } : {}) as never))
              .filter((t) => !["completed", "cancelled"].includes(t.status));
            const blocking = await cloudBlockingDepsMap(cloud, candidates);
            const remote = candidates.filter((t) => blocking.has(t.id));
            if (remote.length === 0) return { content: [{ type: "text" as const, text: "No blocked tasks." }] };
            const remoteLines = remote.map((t) => `${(t.short_id || t.id.slice(0, 8))} [${t.status}] ${t.title} — blocked by ${(blocking.get(t.id) ?? []).map((b) => b.id.slice(0, 8)).join(", ")}`);
            return { content: [{ type: "text" as const, text: `${remote.length} blocked task(s):\n${remoteLines.join("\n")}` }] };
          }
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
          // http authority routing: GET /v1/dependencies gives the edges; the
          // blockers are then read back with GET /v1/tasks/:id.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const edges = await cloudAllDependencies(cloud);
            const dependentCount = new Map<string, number>();
            for (const edge of edges) {
              if (!edge.task_id || !edge.depends_on) continue;
              dependentCount.set(edge.depends_on, (dependentCount.get(edge.depends_on) ?? 0) + 1);
            }
            const blockers = await cloudGetTasksByIds(cloud, [...dependentCount.keys()]);
            const remote = [...blockers.values()]
              .filter((t) => !["completed", "cancelled"].includes(t.status))
              .filter((t) => !project_id || t.project_id === project_id)
              .sort((a, b) => (dependentCount.get(b.id) ?? 0) - (dependentCount.get(a.id) ?? 0));
            if (remote.length === 0) return { content: [{ type: "text" as const, text: "No tasks blocking others." }] };
            const remoteLines = remote.map((t) => `${(t.short_id || t.id.slice(0, 8))} [${t.status}] ${t.title} — blocking ${dependentCount.get(t.id) ?? 0} task(s)`);
            return { content: [{ type: "text" as const, text: `${remote.length} blocking task(s):\n${remoteLines.join("\n")}` }] };
          }
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
          // http authority routing: report health from the shared cloud dataset.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const [stats, pending, inProgress, completed, cancelled, projects, agents] = await Promise.all([
              cloudGetStats(cloud),
              cloudCountTasks(cloud, { status: "pending" } as never),
              cloudCountTasks(cloud, { status: "in_progress" } as never),
              cloudCountTasks(cloud, { status: "completed" } as never),
              cloudCountTasks(cloud, { status: "cancelled" } as never),
              cloudListProjects(cloud),
              cloudListAgents(cloud),
            ]);
            const projectCount = (stats.projects as number | undefined) ?? projects.length;
            const lines = [
              `=== System Health (cloud) ===`,
              `Tasks: ${pending} pending | ${inProgress} in progress | ${completed} completed | ${cancelled} cancelled`,
              `Projects: ${projectCount} total`,
              `Agents: ${agents.length} registered`,
            ];
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }

          const { countTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const { listProjects } = require("../../db/projects.js") as typeof import("../../db/projects.js");
          const { listAgents } = require("../../db/agents.js") as typeof import("../../db/agents.js");

          const pending = countTasks({ status: "pending" });
          const inProgress = countTasks({ status: "in_progress" });
          const completed = countTasks({ status: "completed" });
          const cancelled = countTasks({ status: "cancelled" });

          const projects = listProjects();
          const agents = listAgents();

          const lines = [
            `=== System Health ===`,
            `Tasks: ${pending} pending | ${inProgress} in progress | ${completed} completed | ${cancelled} cancelled`,
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

  if (shouldRegisterTool("run_doctor")) {
    server.tool(
      "run_doctor",
      "Run local doctor diagnostics and optionally apply safe repairs after dry-run review.",
      {
        apply: z.boolean().optional().describe("Apply safe repairs. Defaults to false/dry-run."),
      },
      async ({ apply }) => {
        try {
          // http authority routing: GET /v1/integrity is the hosted analogue of
          // the local doctor's read. `apply` is refused rather than silently
          // reported as a no-op — the hosted store has no client-side repair.
          const cloud = getTodosCloudClient();
          if (cloud) {
            if (apply) {
              return { content: [{ type: "text" as const, text: "run_doctor --apply is not available on the hosted authority: repairs are server-side. Re-run without apply for the hosted integrity report." }], isError: true };
            }
            const report = await cloudGetIntegrityReport(cloud);
            if (!report) throw new Error("The configured Todos authority returned no integrity report");
            return { content: [{ type: "text" as const, text: JSON.stringify({ source: "cloud", integrity: report }, null, 2) }] };
          }
          const { runTodosDoctor } = require("../../lib/doctor.js") as typeof import("../../lib/doctor.js");
          const result = runTodosDoctor({ apply: Boolean(apply) });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
