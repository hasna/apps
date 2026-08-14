import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerReportExportTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("build_report_export")) {
    server.tool(
      "build_report_export",
      "Build read-only local report data (project, plan, run, evidence, roadmap, retrospective).",
      {
        kind: z.enum(["project", "plan", "run", "evidence", "roadmap", "retrospective"]),
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        run_record_id: z.string().optional(),
        task_id: z.string().optional(),
        days: z.number().optional(),
        redact: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { buildReportExportData } = await import("../../lib/report-exports.js");
          const data = buildReportExportData({
            kind: params.kind,
            project_id: params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined,
            plan_id: params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined,
            run_record_id: params.run_record_id,
            task_id: params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined,
            days: params.days,
            redact: params.redact,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("export_report_file")) {
    server.tool(
      "export_report_file",
      "Write a read-only HTML or Markdown report file to a local path.",
      {
        kind: z.enum(["project", "plan", "run", "evidence", "roadmap", "retrospective"]),
        format: z.enum(["markdown", "html"]),
        path: z.string(),
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        run_record_id: z.string().optional(),
        task_id: z.string().optional(),
        days: z.number().optional(),
        redact: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { exportReport } = await import("../../lib/report-exports.js");
          const data = exportReport({
            kind: params.kind,
            format: params.format,
            path: params.path,
            project_id: params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined,
            plan_id: params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined,
            run_record_id: params.run_record_id,
            task_id: params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined,
            days: params.days,
            redact: params.redact,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, path: params.path, title: data.title }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
