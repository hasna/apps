import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerSavedViewTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("unified_search")) {
    server.tool(
      "unified_search",
      "Local unified search across tasks, projects, plans, comments, and runs.",
      {
        query: z.string().optional(),
        entity_types: z.array(z.enum(["task", "project", "plan", "comment", "run", "all"])).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        project_id: z.string().optional(),
      },
      async ({ query, entity_types, limit, offset, status, priority, project_id }) => {
        try {
          const { unifiedSearch } = await import("../../lib/saved-views.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          const result = unifiedSearch({
            query,
            entity_types,
            limit,
            offset,
            task_filters: { status, priority, project_id: projectId },
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_saved_view")) {
    server.tool(
      "create_saved_view",
      "Create a saved search filter/view.",
      {
        name: z.string(),
        entity_type: z.enum(["task", "project", "plan", "comment", "run", "all"]).optional(),
        filters: z.record(z.unknown()).optional(),
        slug: z.string().optional(),
      },
      async (params) => {
        try {
          const { createSavedView } = await import("../../lib/saved-views.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(createSavedView(params), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_saved_views")) {
    server.tool(
      "list_saved_views",
      "List saved search views.",
      {},
      async () => {
        try {
          const { listSavedViews } = await import("../../lib/saved-views.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(listSavedViews(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("run_saved_view")) {
    server.tool(
      "run_saved_view",
      "Execute a saved view by slug or id.",
      {
        view: z.string(),
        query: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
      async ({ view, ...rest }) => {
        try {
          const { runSavedView } = await import("../../lib/saved-views.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(runSavedView(view, rest), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
