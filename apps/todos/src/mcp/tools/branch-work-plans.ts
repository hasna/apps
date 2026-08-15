import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerBranchWorkPlanTools(
  server: McpServer,
  { shouldRegisterTool, formatError }: Helpers,
): void {
  if (shouldRegisterTool("analyze_branch_work")) {
    server.tool(
      "analyze_branch_work",
      "Analyze local git branch vs base: ahead/behind, overlapping files, predicted merge conflicts.",
      {
        cwd: z.string().optional(),
        branch: z.string().optional(),
        base_branch: z.string().optional(),
      },
      async (params) => {
        try {
          const { analyzeBranchWork } = await import("../../lib/branch-work-plans.js");
          const analysis = analyzeBranchWork(params);
          return { content: [{ type: "text" as const, text: JSON.stringify(analysis, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("generate_branch_work_plan")) {
    server.tool(
      "generate_branch_work_plan",
      "Generate a safe step-by-step branch integration work plan for agents.",
      {
        cwd: z.string().optional(),
        branch: z.string().optional(),
        base_branch: z.string().optional(),
        prefer_strategy: z.enum(["merge", "rebase"]).optional(),
        format: z.enum(["json", "markdown", "text"]).optional(),
      },
      async (params) => {
        try {
          const { generateSafeWorkPlan, formatSafeWorkPlanMarkdown, formatSafeWorkPlanText } =
            await import("../../lib/branch-work-plans.js");
          const plan = generateSafeWorkPlan({
            cwd: params.cwd,
            branch: params.branch,
            base_branch: params.base_branch,
            prefer_strategy: params.prefer_strategy,
          });
          const format = params.format ?? "json";
          const text = format === "markdown"
            ? formatSafeWorkPlanMarkdown(plan)
            : format === "text"
              ? formatSafeWorkPlanText(plan)
              : JSON.stringify(plan, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_branch_work_plan_docs")) {
    server.tool(
      "get_branch_work_plan_docs",
      "Documentation for local branch work plan analysis and safe integration steps.",
      {},
      async () => {
        try {
          const { getBranchWorkPlanDocs } = await import("../../lib/branch-work-plans.js");
          return { content: [{ type: "text" as const, text: getBranchWorkPlanDocs() }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
