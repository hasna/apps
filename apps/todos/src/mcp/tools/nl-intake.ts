import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerNlIntakeTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("preview_nl_intake")) {
    server.tool(
      "preview_nl_intake",
      "Preview natural-language task intake with local parsing, dedupe, and redaction (dry-run).",
      {
        text: z.string(),
        project_id: z.string().optional(),
        task_list_id: z.string().optional(),
        agent_id: z.string().optional(),
        assigned_to: z.string().optional(),
        tags: z.array(z.string()).optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        format: z.enum(["json", "text"]).optional(),
      },
      async (params) => {
        try {
          const { previewNlIntake, formatNlIntakePreviewText } = await import("../../lib/nl-intake.js");
          const projectId = params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined;
          const taskListId = params.task_list_id ? resolveId(params.task_list_id, "task_lists") ?? params.task_list_id : undefined;
          const preview = previewNlIntake({ ...params, project_id: projectId, task_list_id: taskListId });
          const text = params.format === "text" ? formatNlIntakePreviewText(preview) : JSON.stringify(preview, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_nl_intake")) {
    server.tool(
      "create_nl_intake",
      "Create a task from natural-language intake with local parsing, dedupe, and redaction.",
      {
        text: z.string(),
        project_id: z.string().optional(),
        task_list_id: z.string().optional(),
        agent_id: z.string().optional(),
        assigned_to: z.string().optional(),
        tags: z.array(z.string()).optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        dry_run: z.boolean().optional(),
        skip_dedupe: z.boolean().optional(),
        force: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { createNlIntake } = await import("../../lib/nl-intake.js");
          const { dry_run, skip_dedupe, force, project_id, task_list_id, ...rest } = params;
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          const taskListId = task_list_id ? resolveId(task_list_id, "task_lists") ?? task_list_id : undefined;
          const result = createNlIntake(
            { ...rest, project_id: projectId, task_list_id: taskListId },
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
