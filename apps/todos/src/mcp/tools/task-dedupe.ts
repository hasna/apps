import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerTaskDedupeTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("find_duplicate_tasks")) {
    server.tool(
      "find_duplicate_tasks",
      "Find likely duplicate tasks by title, description, files, commits, and external refs.",
      {
        project_id: z.string().optional(),
        task_id: z.string().optional(),
        min_score: z.number().optional(),
        limit: z.number().optional(),
        format: z.enum(["json", "text"]).optional(),
      },
      async (params) => {
        try {
          const { findDuplicateCandidates, formatDuplicatePreview } = await import("../../lib/task-dedupe.js");
          const taskId = params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined;
          const projectId = params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined;
          const candidates = findDuplicateCandidates({ ...params, task_id: taskId, project_id: projectId });
          const text = params.format === "text"
            ? formatDuplicatePreview(candidates)
            : JSON.stringify(candidates, null, 2);
          return { content: [{ type: "text" as const, text: text || "No duplicate candidates found." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("merge_tasks")) {
    server.tool(
      "merge_tasks",
      "Merge duplicate tasks into a primary record, preserving comments/commits/files and audit history.",
      {
        primary_id: z.string(),
        secondary_id: z.string(),
        agent_id: z.string().optional(),
        delete_secondary: z.boolean().optional(),
        dry_run: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { mergeTasks } = await import("../../lib/task-dedupe.js");
          const result = mergeTasks({
            primary_id: resolveId(params.primary_id, "tasks") ?? params.primary_id,
            secondary_id: resolveId(params.secondary_id, "tasks") ?? params.secondary_id,
            agent_id: params.agent_id,
            delete_secondary: params.delete_secondary,
            dry_run: params.dry_run,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
