import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerPlanExecutionTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("attach_plan_to_project")) {
    server.tool(
      "attach_plan_to_project",
      "Attach a plan to a project and initialize plan execution mode.",
      {
        plan_id: z.string(),
        project_id: z.string(),
        execution_mode: z.enum(["sequential", "parallel"]).optional(),
      },
      async ({ plan_id, project_id, execution_mode }) => {
        try {
          const { attachPlanToProject } = await import("../../lib/plan-execution.js");
          const planId = resolveId(plan_id, "plans") ?? plan_id;
          const projectId = resolveId(project_id, "projects") ?? project_id;
          const manifest = attachPlanToProject({ plan_id: planId, project_id: projectId, execution_mode });
          return { content: [{ type: "text" as const, text: JSON.stringify(manifest, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("materialize_plan_steps")) {
    server.tool(
      "materialize_plan_steps",
      "Split plan into ordered step tasks with sequential or parallel execution.",
      {
        plan_id: z.string(),
        steps: z.array(z.object({
          title: z.string(),
          description: z.string().optional(),
          priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        })),
        execution_mode: z.enum(["sequential", "parallel"]).optional(),
      },
      async ({ plan_id, steps, execution_mode }) => {
        try {
          const { materializePlanSteps } = await import("../../lib/plan-execution.js");
          const planId = resolveId(plan_id, "plans") ?? plan_id;
          const manifest = materializePlanSteps({ plan_id: planId, steps, execution_mode });
          return { content: [{ type: "text" as const, text: JSON.stringify(manifest, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_plan_execution_state")) {
    server.tool(
      "get_plan_execution_state",
      "Get plan execution progress, current step, and ready steps.",
      { plan_id: z.string() },
      async ({ plan_id }) => {
        try {
          const { getPlanExecutionState } = await import("../../lib/plan-execution.js");
          const planId = resolveId(plan_id, "plans") ?? plan_id;
          const state = getPlanExecutionState(planId);
          if (!state) return { content: [{ type: "text" as const, text: "Plan not found." }], isError: true };
          return { content: [{ type: "text" as const, text: JSON.stringify(state, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("claim_plan_step")) {
    server.tool(
      "claim_plan_step",
      "Claim and start the next ready plan step for an agent.",
      {
        plan_id: z.string(),
        agent_id: z.string(),
      },
      async ({ plan_id, agent_id }) => {
        try {
          const { claimPlanStep } = await import("../../lib/plan-execution.js");
          const planId = resolveId(plan_id, "plans") ?? plan_id;
          const task = claimPlanStep(planId, agent_id);
          if (!task) return { content: [{ type: "text" as const, text: "No ready plan step to claim." }] };
          return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("export_plan_execution_contract")) {
    server.tool(
      "export_plan_execution_contract",
      "Export portable plan execution contract JSON for hosted bridge.",
      { plan_id: z.string() },
      async ({ plan_id }) => {
        try {
          const { exportPlanExecutionContract } = await import("../../lib/plan-execution.js");
          const planId = resolveId(plan_id, "plans") ?? plan_id;
          const contract = exportPlanExecutionContract(planId);
          if (!contract) return { content: [{ type: "text" as const, text: "Plan not found." }], isError: true };
          return { content: [{ type: "text" as const, text: JSON.stringify(contract, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
