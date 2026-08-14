import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerUserScaffoldTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("list_user_scaffolds")) {
    server.tool("list_user_scaffolds", "List user-authored local scaffolds.", { kind: z.string().optional() }, async (params) => {
      try {
        const { listUserScaffolds, SCAFFOLD_KINDS } = await import("../../lib/user-scaffolds.js");
        const kind = params.kind && SCAFFOLD_KINDS.includes(params.kind as never) ? (params.kind as never) : undefined;
        return { content: [{ type: "text" as const, text: JSON.stringify(listUserScaffolds(kind), null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    });
  }

  if (shouldRegisterTool("preview_user_scaffold")) {
    server.tool(
      "preview_user_scaffold",
      "Dry-run preview of a user scaffold with variables.",
      { id_or_slug: z.string(), variables: z.record(z.string()).optional() },
      async (params) => {
        try {
          const { previewUserScaffold } = await import("../../lib/user-scaffolds.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(previewUserScaffold(params.id_or_slug, params.variables), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("apply_user_scaffold")) {
    server.tool(
      "apply_user_scaffold",
      "Apply a user scaffold (materialize tasks/plans where supported).",
      { id_or_slug: z.string(), variables: z.record(z.string()).optional() },
      async (params) => {
        try {
          const { applyUserScaffold } = await import("../../lib/user-scaffolds.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(applyUserScaffold(params.id_or_slug, params.variables), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
