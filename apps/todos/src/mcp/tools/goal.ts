import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerGoalTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("create_goal_workflow")) {
    server.tool(
      "create_goal_workflow",
      "Create a /goal-style plan with decomposed step tasks (local-only).",
      {
        goal: z.string(),
        project_id: z.string().optional(),
        agent_id: z.string().optional(),
        steps: z.array(z.object({
          title: z.string(),
          description: z.string().optional(),
          priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        })).optional(),
        sequential: z.boolean().optional().describe("Chain steps with dependencies (default true)"),
      },
      async (params) => {
        try {
          const { createGoalWorkflow } = await import("../../lib/goal-workflow.js");
          const projectId = params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined;
          const manifest = createGoalWorkflow({ ...params, project_id: projectId });
          return { content: [{ type: "text" as const, text: JSON.stringify(manifest, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_goal_status")) {
    server.tool(
      "get_goal_status",
      "Get /goal plan progress and current step.",
      { plan_ref: z.string().describe("Plan ID or name/slug") },
      async ({ plan_ref }) => {
        try {
          const { getGoalProgress } = await import("../../lib/goal-workflow.js");
          const progress = getGoalProgress(plan_ref);
          if (!progress) return { content: [{ type: "text" as const, text: "Plan not found." }] };
          return { content: [{ type: "text" as const, text: JSON.stringify(progress, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("claim_goal_step")) {
    server.tool(
      "claim_goal_step",
      "Claim the next ready /goal step for an agent (equivalent to /goal execute).",
      {
        plan_ref: z.string(),
        agent_id: z.string(),
      },
      async ({ plan_ref, agent_id }) => {
        try {
          const { claimGoalStep } = await import("../../lib/goal-workflow.js");
          const task = claimGoalStep(plan_ref, agent_id);
          if (!task) return { content: [{ type: "text" as const, text: "No claimable goal step found." }] };
          return { content: [{ type: "text" as const, text: `Claimed: ${task.short_id || task.id.slice(0, 8)} ${task.title} (${task.status})` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("format_goal_handoff")) {
    server.tool(
      "format_goal_handoff",
      "Produce JSON or Markdown handoff packet for a /goal plan.",
      {
        plan_ref: z.string(),
        format: z.enum(["json", "markdown"]).optional(),
        agent_id: z.string().optional(),
      },
      async ({ plan_ref, format, agent_id }) => {
        try {
          const { formatGoalHandoff } = await import("../../lib/goal-workflow.js");
          const output = formatGoalHandoff(plan_ref, format ?? "json", agent_id);
          if (!output) return { content: [{ type: "text" as const, text: "Plan not found." }] };
          return { content: [{ type: "text" as const, text: output }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  server.resource(
    "todos://goal-recipes",
    "Local /goal command recipes for Codex, Claude Code, Takumi, and MCP agents",
    async () => {
      const { getGoalCommandRecipesMarkdown } = await import("../../lib/goal-workflow.js");
      return { contents: [{ uri: "todos://goal-recipes", mimeType: "text/markdown", text: getGoalCommandRecipesMarkdown() }] };
    },
  );
}
