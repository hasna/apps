import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerIssueImporterTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("preview_issue_import")) {
    server.tool(
      "preview_issue_import",
      "Preview importing GitHub, Linear, or Jira issues from local JSON export files with dedupe.",
      {
        file_path: z.string().optional(),
        json: z.string().optional(),
        source: z.enum(["github", "linear", "jira", "auto"]).optional(),
        project_id: z.string().optional(),
        task_list_id: z.string().optional(),
        tags: z.array(z.string()).optional(),
        format: z.enum(["json", "text"]).optional(),
      },
      async (params) => {
        try {
          const { previewIssueImport, formatIssueImportPreviewText } = await import("../../lib/issue-importers.js");
          const projectId = params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined;
          const taskListId = params.task_list_id
            ? resolveId(params.task_list_id, "task_lists") ?? params.task_list_id
            : undefined;
          const preview = previewIssueImport({
            ...params,
            project_id: projectId,
            task_list_id: taskListId,
          });
          const text =
            params.format === "text" ? formatIssueImportPreviewText(preview) : JSON.stringify(preview, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("import_issues")) {
    server.tool(
      "import_issues",
      "Import GitHub, Linear, or Jira issues from local JSON export files with dedupe.",
      {
        file_path: z.string().optional(),
        json: z.string().optional(),
        source: z.enum(["github", "linear", "jira", "auto"]).optional(),
        project_id: z.string().optional(),
        task_list_id: z.string().optional(),
        tags: z.array(z.string()).optional(),
        dry_run: z.boolean().optional(),
        skip_dedupe: z.boolean().optional(),
        force: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { importIssues } = await import("../../lib/issue-importers.js");
          const { dry_run, skip_dedupe, force, project_id, task_list_id, ...rest } = params;
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          const taskListId = task_list_id ? resolveId(task_list_id, "task_lists") ?? task_list_id : undefined;
          const result = importIssues(
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
