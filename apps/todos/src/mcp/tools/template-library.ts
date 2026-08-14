import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerTemplateLibraryTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("list_template_library")) {
    server.tool(
      "list_template_library",
      "List bundled marketplace-free template library (local-only).",
      {},
      async () => {
        try {
          const { listTemplateLibrary } = await import("../../lib/template-library.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(listTemplateLibrary(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("preview_template_library")) {
    server.tool(
      "preview_template_library",
      "Preview a bundled template with variable substitution (no tasks created).",
      {
        name: z.string(),
        variables: z.record(z.string()).optional(),
      },
      async ({ name, variables }) => {
        try {
          const { previewBuiltinTemplate } = await import("../../lib/template-library.js");
          const preview = previewBuiltinTemplate(name, variables ?? {});
          if (!preview) return { content: [{ type: "text" as const, text: `Template not found: ${name}` }], isError: true };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("install_template_library")) {
    server.tool(
      "install_template_library",
      "Install all bundled templates into local database (idempotent).",
      {},
      async () => {
        try {
          const { installTemplateLibrary } = await import("../../lib/template-library.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(installTemplateLibrary(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
