// @ts-nocheck
/**
 * Task workflow tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";
import { TaskNotFoundError, VersionConflictError } from "../../types/index.js";

interface TaskWorkflowContext {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table?: string) => string;
  formatError: (error: unknown) => string;
  formatTask: (task: Task) => string;
  formatTaskDetail: (task: Task, maxDescriptionChars?: number) => string;
  getAgentFocus: (agentId: string) => { agent_id: string; project_id?: string } | undefined;
}

export function registerTaskWorkflowTools(server: McpServer, ctx: TaskWorkflowContext) {
  const { shouldRegisterTool, resolveId, formatError, formatTask } = ctx;

  function versionFor(taskId: string, version?: number): number {
    const { getTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
    const current = getTask(taskId);
    if (!current) throw new TaskNotFoundError(taskId);
    if (version !== undefined && current.version !== version) {
      throw new VersionConflictError(taskId, version, current.version);
    }
    return current.version;
  }

  // === APPROVE / FAIL ===

  if (shouldRegisterTool("approve_task")) {
    server.tool(
      "approve_task",
      "Approve a task that requires_approval. Records who approved it.",
      {
        task_id: z.string().describe("Task ID"),
        approved_by: z.string().optional().describe("Agent ID who approved"),
        notes: z.string().optional().describe("Approval notes"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, approved_by, notes, version }) => {
        try {
          const { updateTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedId = resolveId(task_id);
          const resolvedApprover = approved_by ? resolveId(approved_by, "agents") : undefined;
          const task = updateTask(resolvedId, {
            approved_by: resolvedApprover,
            metadata: notes ? { approval_notes: notes } : {},
            version: versionFor(resolvedId, version),
          });
          return { content: [{ type: "text" as const, text: `Task ${task_id.slice(0,8)} approved by ${resolvedApprover || "unknown"}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("fail_task")) {
    server.tool(
      "fail_task",
      "Mark a task as failed. Increments retry_count. Sets back_on_board=false so agent stays assigned.",
      {
        task_id: z.string().describe("Task ID"),
        reason: z.string().optional().describe("Failure reason"),
        agent_id: z.string().optional().describe("Agent marking as failed"),
        version: z.number().optional().describe("Expected version for optimistic locking"),
      },
      async ({ task_id, reason, agent_id, version }) => {
        try {
          const { failTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const resolvedId = resolveId(task_id);
          versionFor(resolvedId, version);
          const result = failTask(resolvedId, agent_id, reason);
          return { content: [{ type: "text" as const, text: `Task ${task_id.slice(0,8)} marked failed. Retry count: ${result.task.retry_count}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // === MY TASKS ===

  if (shouldRegisterTool("get_my_tasks")) {
    server.tool(
      "get_my_tasks",
      "Get tasks assigned to the calling agent. Supports focus mode scoping.",
      {
        agent_id: z.string().optional().describe("Agent ID (defaults to context agent)"),
        status: z.enum(["pending", "in_progress", "completed", "failed", "cancelled"]).optional().describe("Filter by status"),
        project_id: z.string().optional().describe("Filter by project (respects focus mode)"),
        limit: z.number().optional().describe("Max results (default: 50)"),
      },
      async ({ agent_id, status, project_id, limit }) => {
        try {
          const { listTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const focus = ctx.getAgentFocus(agent_id || "");
          const effectiveAgentId = focus ? focus.agent_id : agent_id || "";
          const effectiveProjectId = focus?.project_id || project_id;
          const tasks = listTasks({
            assigned_to: effectiveAgentId,
            status,
            project_id: effectiveProjectId ? resolveId(effectiveProjectId, "projects") : undefined,
            limit: limit || 50,
          }, undefined) as Task[];
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "No tasks found." }] };
          const lines = tasks.map(formatTask);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_next_task")) {
    server.tool(
      "get_next_task",
      "Get the best available pending task without claiming it.",
      {
        agent_id: z.string().optional().describe("Agent ID or name for assignment affinity"),
        project_id: z.string().optional().describe("Filter by project"),
        task_list_id: z.string().optional().describe("Filter by task list"),
        plan_id: z.string().optional().describe("Filter by plan"),
        tags: z.array(z.string()).optional().describe("Filter by tags"),
      },
      async ({ agent_id, project_id, task_list_id, plan_id, tags }) => {
        try {
          const { getNextTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const filters: Record<string, unknown> = {};
          if (project_id) filters.project_id = resolveId(project_id, "projects");
          if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");
          if (plan_id) filters.plan_id = resolveId(plan_id, "plans");
          if (tags) filters.tags = tags;
          const task = getNextTask(agent_id, filters);
          return { content: [{ type: "text" as const, text: task ? formatTask(task) : "No available task." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("claim_next_task")) {
    server.tool(
      "claim_next_task",
      "Atomically claim and start the best available pending task for an agent.",
      {
        agent_id: z.string().describe("Agent ID or name claiming the task"),
        project_id: z.string().optional().describe("Filter by project"),
        task_list_id: z.string().optional().describe("Filter by task list"),
        plan_id: z.string().optional().describe("Filter by plan"),
        tags: z.array(z.string()).optional().describe("Filter by tags"),
      },
      async ({ agent_id, project_id, task_list_id, plan_id, tags }) => {
        try {
          const { claimNextTask } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const filters: Record<string, unknown> = {};
          if (project_id) filters.project_id = resolveId(project_id, "projects");
          if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");
          if (plan_id) filters.plan_id = resolveId(plan_id, "plans");
          if (tags) filters.tags = tags;
          const task = claimNextTask(agent_id, filters);
          return { content: [{ type: "text" as const, text: task ? formatTask(task) : "No available task to claim." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_tasks_changed_since")) {
    server.tool(
      "get_tasks_changed_since",
      "List tasks changed since an ISO timestamp.",
      {
        since: z.string().describe("ISO timestamp"),
        project_id: z.string().optional().describe("Filter by project"),
        task_list_id: z.string().optional().describe("Filter by task list"),
        limit: z.number().optional().describe("Maximum tasks to return"),
      },
      async ({ since, project_id, task_list_id, limit }) => {
        try {
          const { getTasksChangedSince } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const filters: Record<string, string> = {};
          if (project_id) filters.project_id = resolveId(project_id, "projects");
          if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");
          const tasks = getTasksChangedSince(since, filters).slice(0, limit || 50);
          if (tasks.length === 0) return { content: [{ type: "text" as const, text: "No changed tasks." }] };
          return { content: [{ type: "text" as const, text: tasks.map(formatTask).join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  function registerContextTool(name: "get_context" | "bootstrap", description: string) {
    if (!shouldRegisterTool(name)) return;
    server.tool(
      name,
      description,
      {
        agent_id: z.string().optional().describe("Agent ID or name"),
        project_id: z.string().optional().describe("Filter by project"),
        task_list_id: z.string().optional().describe("Filter by task list"),
        explain_blocked: z.boolean().optional().describe("Include blocked task details"),
      },
      async ({ agent_id, project_id, task_list_id, explain_blocked }) => {
        try {
          const { getStatus, getNextTask, getOverdueTasks } = require("../../db/tasks.js") as typeof import("../../db/tasks.js");
          const { getLatestHandoff } = require("../../db/handoffs.js") as typeof import("../../db/handoffs.js");
          const filters: Record<string, string> = {};
          if (project_id) filters.project_id = resolveId(project_id, "projects");
          if (task_list_id) filters.task_list_id = resolveId(task_list_id, "task_lists");
          const status = getStatus(filters, agent_id, { explain_blocked });
          const next_task = getNextTask(agent_id, filters);
          const overdue = getOverdueTasks(filters.project_id);
          const latest_handoff = getLatestHandoff(agent_id, filters.project_id);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                status,
                next_task,
                overdue_count: overdue.length,
                latest_handoff,
                as_of: new Date().toISOString(),
              }, null, 2),
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  registerContextTool("get_context", "Get session start context: queue status, next task, overdue count, and latest handoff.");
  registerContextTool("bootstrap", "Bootstrap an agent session with queue context and the next available task.");

  // === ORG CHART ===

  if (shouldRegisterTool("get_org_chart")) {
    server.tool(
      "get_org_chart",
      "Get the global org chart (agent hierarchy + titles).",
      {
        format: z.enum(["text", "json"]).optional().describe("Output format (default: text)"),
      },
      async ({ format }) => {
        try {
          const { getOrgChart } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const tree = getOrgChart();

          if (format === "json") {
            return { content: [{ type: "text" as const, text: JSON.stringify(tree, null, 2) }] };
          }

          const now = Date.now();
          const ACTIVE_MS = 30 * 60 * 1000;
          function render(nodes: any[], indent = 0): string {
            return nodes.map(n => {
              const prefix = "  ".repeat(indent);
              const title = n.agent.title ? ` — ${n.agent.title}` : "";
              const globalRole = n.agent.role ? ` [${n.agent.role}]` : "";
              const lead = n.is_lead ? " ★" : "";
              const lastSeen = new Date(n.agent.last_seen_at).getTime();
              const active = now - lastSeen < ACTIVE_MS ? " ●" : " ○";
              const line = `${prefix}${active} ${n.agent.name}${title}${globalRole}${lead}`;
              const children = n.reports.length > 0 ? "\n" + render(n.reports, indent + 1) : "";
              return line + children;
            }).join("\n");
          }
          const text = tree.length > 0 ? render(tree) : "No agents in org chart.";
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_reports_to")) {
    server.tool(
      "set_reports_to",
      "Set which agent another agent reports to (org chart hierarchy).",
      {
        agent_id: z.string().describe("Agent who reports"),
        reports_to: z.string().describe("Manager agent ID or name"),
      },
      async ({ agent_id, reports_to }) => {
        try {
          const { updateAgent } = require("../../db/agents.js") as typeof import("../../db/agents.js");
          const resolvedAgent = resolveId(agent_id, "agents");
          const resolvedManager = resolveId(reports_to, "agents");
          updateAgent(resolvedAgent, { reports_to: resolvedManager });
          return { content: [{ type: "text" as const, text: `${agent_id} now reports to ${reports_to}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
