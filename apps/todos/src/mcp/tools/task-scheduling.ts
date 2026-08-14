import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerTaskSchedulingTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("schedule_task")) {
    server.tool(
      "schedule_task",
      "Set due date, delayed start, or recurrence rule on a task.",
      {
        task_id: z.string(),
        due_at: z.string().optional(),
        scheduled_start_at: z.string().optional(),
        recurrence_rule: z.string().optional(),
      },
      async ({ task_id, ...rest }) => {
        try {
          const { scheduleTask } = await import("../../lib/task-scheduling.js");
          const id = resolveId(task_id, "tasks") ?? task_id;
          const task = scheduleTask(id, rest);
          return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_scheduling_summary")) {
    server.tool(
      "get_scheduling_summary",
      "Local scheduling summary: due, overdue, stale, delayed, recurring, next claimable.",
      {
        agent_id: z.string().optional(),
        project_id: z.string().optional(),
      },
      async ({ agent_id, project_id }) => {
        try {
          const { getSchedulingSummary } = await import("../../lib/task-scheduling.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          return { content: [{ type: "text" as const, text: JSON.stringify(getSchedulingSummary(agent_id, { project_id: projectId }), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_agent_safe_queue")) {
    server.tool(
      "get_agent_safe_queue",
      "Ordered pending task queue respecting delayed starts and due urgency.",
      {
        agent_id: z.string().optional(),
        project_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async ({ agent_id, project_id, limit }) => {
        try {
          const { getAgentSafeQueue } = await import("../../lib/task-scheduling.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          return { content: [{ type: "text" as const, text: JSON.stringify(getAgentSafeQueue(agent_id, { project_id: projectId, limit }), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_stale_task_report")) {
    server.tool(
      "get_stale_task_report",
      "Report stale in_progress tasks with minutes stale.",
      {
        stale_minutes: z.number().optional(),
        project_id: z.string().optional(),
      },
      async ({ stale_minutes, project_id }) => {
        try {
          const { getStaleTaskReport } = await import("../../lib/task-scheduling.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          return { content: [{ type: "text" as const, text: JSON.stringify(getStaleTaskReport(stale_minutes ?? 30, { project_id: projectId }), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  server.resource(
    "todos://agent-scheduling",
    "Agent scheduling loop documentation",
    async () => {
      const { getAgentLoopDocs } = await import("../../lib/task-scheduling.js");
      return { contents: [{ uri: "todos://agent-scheduling", mimeType: "text/markdown", text: getAgentLoopDocs() }] };
    },
  );
}
