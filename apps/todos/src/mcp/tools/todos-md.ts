import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
          const { exportTodosMarkdown } = await import("../../lib/todos-md.js");
          const content = exportTodosMarkdown({ project_id: params.project_id });
          if (params.path) {
            const outputPath = resolve(params.path);
            writeFileSync(outputPath, content);
            return { content: [{ type: "text" as const, text: JSON.stringify({ path: outputPath, bytes: Buffer.byteLength(content) }, null, 2) }] };
          }
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
      {
        path: z.string().optional(),
        apply: z.boolean().optional().describe("Apply the import. Defaults to dry-run."),
        resolve_conflicts: z.boolean().optional().describe("Safely merge embedded bridge conflicts where possible."),
      },
      async ({ path, apply, resolve_conflicts }) => {
        try {
          const { importTodosMarkdown } = await import("../../lib/todos-md.js");
          const inputPath = resolve(path ?? "todos.md");
          const markdown = readFileSync(inputPath, "utf-8");
          const result = importTodosMarkdown(markdown, {
            dryRun: apply !== true,
            conflictStrategy: resolve_conflicts ? "safe_merge" : "skip",
          });
          return { content: [{ type: "text" as const, text: JSON.stringify({ path: inputPath, ...result }, null, 2) }] };
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
      {
        path: z.string().optional(),
        resolve_conflicts: z.boolean().optional().describe("Safely merge embedded bridge conflicts where possible."),
      },
      async ({ path, resolve_conflicts }) => {
        try {
          const { exportTodosMarkdown, importTodosMarkdown } = await import("../../lib/todos-md.js");
          const targetPath = resolve(path ?? "todos.md");
          const markdown = readFileSync(targetPath, "utf-8");
          const imported = importTodosMarkdown(markdown, {
            dryRun: false,
            conflictStrategy: resolve_conflicts ? "safe_merge" : "skip",
          });
          const exported = exportTodosMarkdown();
          writeFileSync(targetPath, exported);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ path: targetPath, imported, exported_bytes: Buffer.byteLength(exported) }, null, 2),
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
