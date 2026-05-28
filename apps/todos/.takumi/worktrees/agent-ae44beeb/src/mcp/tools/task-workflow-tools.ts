// @ts-nocheck
/**
 * Task workflow tools for the MCP server.
 * Auto-extracted from src/mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Task } from "../../types/index.js";

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
          const { updateTask } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const resolvedId = resolveId(task_id);
          const resolvedApprover = approved_by ? resolveId(approved_by, "agents") : undefined;
          const task = updateTask(resolvedId, {
            approved_by: resolvedApprover,
            metadata: notes ? { approval_notes: notes } : {},
          }, version);
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
          const { updateTask } = require("../db/tasks.js") as typeof import("../db/tasks.js");
          const resolvedId = resolveId(task_id);
          const task = updateTask(resolvedId, {
            status: "pending",
            retry_count: (getTask(resolvedId)?.retry_count ?? 0) + 1,
            back_on_board: false,
            metadata: reason ? { failure_reason: reason } : {},
          }, version);
          return { content: [{ type: "text" as const, text: `Task ${task_id.slice(0,8)} marked failed. Retry count: ${task.retry_count}` }] };
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
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional().describe("Filter by status"),
        project_id: z.string().optional().describe("Filter by project (respects focus mode)"),
        limit: z.number().optional().describe("Max results (default: 50)"),
      },
      async ({ agent_id, status, project_id, limit }) => {
        try {
          const { listTasks } = require("../db/tasks.js") as typeof import("../db/tasks.js");
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
          const { getOrgChart } = require("../db/agents.js") as typeof import("../db/agents.js");
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
          const { setReportsTo } = require("../db/agents.js") as typeof import("../db/agents.js");
          const resolvedAgent = resolveId(agent_id, "agents");
          const resolvedManager = resolveId(reports_to, "agents");
          setReportsTo(resolvedAgent, resolvedManager);
          return { content: [{ type: "text" as const, text: `${agent_id} now reports to ${reports_to}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
