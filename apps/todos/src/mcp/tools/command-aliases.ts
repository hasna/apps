import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerCommandAliasTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("list_command_aliases")) {
    server.tool(
      "list_command_aliases",
      "List project-local saved command aliases from .todos/aliases.json.",
      {},
      async () => {
        try {
          const { listCommandAliases, listBuiltinShortcuts } = await import("../../lib/command-aliases.js");
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ saved: listCommandAliases(), builtin: listBuiltinShortcuts() }, null, 2),
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("save_command_alias")) {
    server.tool(
      "save_command_alias",
      "Save or update a project-local command alias.",
      {
        name: z.string(),
        command: z.string(),
        description: z.string().optional(),
      },
      async (params) => {
        try {
          const { saveCommandAlias } = await import("../../lib/command-aliases.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(saveCommandAlias(params), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("resolve_command_query")) {
    server.tool(
      "resolve_command_query",
      "Resolve natural query shortcut or @alias to todos argv with explain/dry-run output.",
      {
        query: z.string(),
        dry_run: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { resolveCommandQuery } = await import("../../lib/command-aliases.js");
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(resolveCommandQuery(params.query, { dry_run: params.dry_run }), null, 2),
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
