import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerTodosMdTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("export_todos_md")) {
    server.tool(
      "export_todos_md",
      "Export tasks to a local todos.md markdown file.",
      {
        path: z.string().optional(),
        project_id: z.string().optional(),
        include_completed: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { exportTodosMd } = await import("../../lib/todos-md.js");
          const content = exportTodosMd(params);
          return { content: [{ type: "text" as const, text: content }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("import_todos_md")) {
    server.tool(
      "import_todos_md",
      "Import tasks from a local todos.md markdown file.",
      { path: z.string().optional() },
      async ({ path }) => {
        try {
          const { importTodosMd } = await import("../../lib/todos-md.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(importTodosMd(path), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("sync_todos_md")) {
    server.tool(
      "sync_todos_md",
      "Import then re-export todos.md to keep markdown and database aligned.",
      { path: z.string().optional() },
      async ({ path }) => {
        try {
          const { syncTodosMd } = await import("../../lib/todos-md.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(syncTodosMd(path), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
