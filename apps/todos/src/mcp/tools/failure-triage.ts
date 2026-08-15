import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerFailureTriageTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("get_failure_triage_report")) {
    server.tool(
      "get_failure_triage_report",
      "Build local failure triage report for failed tasks, runs, verifications, and agent runs.",
      {
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { buildFailureTriageReport } = await import("../../lib/failure-triage.js");
          const report = buildFailureTriageReport({
            project_id: params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined,
            plan_id: params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined,
            limit: params.limit,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("apply_failure_triage")) {
    server.tool(
      "apply_failure_triage",
      "Apply triage action: annotate, retry, reopen, split, or escalate on a failed task/run.",
      {
        task_id: z.string().optional(),
        run_record_id: z.string().optional(),
        agent_run_id: z.string().optional(),
        root_cause: z.string().optional(),
        action: z.enum(["annotate", "retry", "reopen", "split", "escalate"]).optional(),
        agent_id: z.string().optional(),
        split_title: z.string().optional(),
        max_retries: z.number().optional(),
      },
      async (params) => {
        try {
          const { applyFailureTriage } = await import("../../lib/failure-triage.js");
          const result = applyFailureTriage({
            ...params,
            task_id: params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("format_failure_triage_markdown")) {
    server.tool(
      "format_failure_triage_markdown",
      "Format failure triage report as Markdown summary.",
      {
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
      },
      async (params) => {
        try {
          const { buildFailureTriageReport, formatFailureTriageMarkdown } = await import("../../lib/failure-triage.js");
          const report = buildFailureTriageReport({
            project_id: params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined,
            plan_id: params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined,
          });
          return { content: [{ type: "text" as const, text: formatFailureTriageMarkdown(report) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
