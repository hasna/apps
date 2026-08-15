import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerDependencyGraphTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("get_ready_tasks")) {
    server.tool(
      "get_ready_tasks",
      "List pending unblocked tasks ready to claim, ordered by priority.",
      {
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async ({ project_id, plan_id, limit }) => {
        try {
          const { getReadyTasks } = await import("../../lib/dependency-graph.js");
          const result = getReadyTasks({
            project_id: project_id ? resolveId(project_id, "projects") ?? project_id : undefined,
            plan_id: plan_id ? resolveId(plan_id, "plans") ?? plan_id : undefined,
            limit,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_blocked_task_reports")) {
    server.tool(
      "get_blocked_task_reports",
      "List blocked tasks with blockers, stale blockers, and missing dependency refs.",
      {
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async ({ project_id, plan_id, limit }) => {
        try {
          const { getBlockedTaskReports } = await import("../../lib/dependency-graph.js");
          const result = getBlockedTaskReports({
            project_id: project_id ? resolveId(project_id, "projects") ?? project_id : undefined,
            plan_id: plan_id ? resolveId(plan_id, "plans") ?? plan_id : undefined,
            limit,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_dependency_critical_path")) {
    server.tool(
      "get_dependency_critical_path",
      "Critical path — tasks blocking the most downstream work.",
      {
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async ({ project_id, plan_id, limit }) => {
        try {
          const { getCriticalPath } = await import("../../lib/dependency-graph.js");
          const result = getCriticalPath({
            project_id: project_id ? resolveId(project_id, "projects") ?? project_id : undefined,
            plan_id: plan_id ? resolveId(plan_id, "plans") ?? plan_id : undefined,
            limit,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_unlock_impact")) {
    server.tool(
      "get_unlock_impact",
      "Show which dependent tasks would become ready if a task completes.",
      { task_id: z.string() },
      async ({ task_id }) => {
        try {
          const { getUnlockImpact } = await import("../../lib/dependency-graph.js");
          const id = resolveId(task_id, "tasks") ?? task_id;
          return { content: [{ type: "text" as const, text: JSON.stringify(getUnlockImpact(id), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("analyze_dependency_graph")) {
    server.tool(
      "analyze_dependency_graph",
      "Full dependency graph analysis: ready, blocked, cycles, missing deps, critical path.",
      {
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async ({ project_id, plan_id, limit }) => {
        try {
          const { analyzeDependencyGraph } = await import("../../lib/dependency-graph.js");
          const result = analyzeDependencyGraph({
            project_id: project_id ? resolveId(project_id, "projects") ?? project_id : undefined,
            plan_id: plan_id ? resolveId(plan_id, "plans") ?? plan_id : undefined,
            limit,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
