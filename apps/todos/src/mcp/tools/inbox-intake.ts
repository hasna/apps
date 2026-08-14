import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerInboxIntakeTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("preview_inbox_intake")) {
    server.tool(
      "preview_inbox_intake",
      "Preview local inbox intake (GitHub issue, CI log, feedback, error paste, file) with dedupe and redaction.",
      {
        text: z.string().optional(),
        file_path: z.string().optional(),
        github_url: z.string().optional(),
        source_type: z.enum(["github_issue", "ci_log", "feedback", "error_paste", "file", "text"]).optional(),
        title: z.string().optional(),
        project_id: z.string().optional(),
        tags: z.array(z.string()).optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        format: z.enum(["json", "text"]).optional(),
      },
      async (params) => {
        try {
          const { previewInboxIntake, formatIntakePreviewText } = await import("../../lib/inbox-intake.js");
          const projectId = params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined;
          const preview = previewInboxIntake({ ...params, project_id: projectId });
          const text = params.format === "text" ? formatIntakePreviewText(preview) : JSON.stringify(preview, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_inbox_intake")) {
    server.tool(
      "create_inbox_intake",
      "Create a task from local inbox intake with dedupe, redaction, and source metadata.",
      {
        text: z.string().optional(),
        file_path: z.string().optional(),
        github_url: z.string().optional(),
        source_type: z.enum(["github_issue", "ci_log", "feedback", "error_paste", "file", "text"]).optional(),
        title: z.string().optional(),
        project_id: z.string().optional(),
        tags: z.array(z.string()).optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        dry_run: z.boolean().optional(),
        skip_dedupe: z.boolean().optional(),
        force: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { createInboxIntake } = await import("../../lib/inbox-intake.js");
          const { dry_run, skip_dedupe, force, project_id, ...rest } = params;
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          const result = createInboxIntake(
            { ...rest, project_id: projectId },
            { dry_run, skip_dedupe, force },
          );
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
