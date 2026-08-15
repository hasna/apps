import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerCliDocsTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("get_cli_reference")) {
    server.tool(
      "get_cli_reference",
      "Manpage-grade CLI reference: command groups, env vars, exit codes.",
      { format: z.enum(["markdown", "manpage"]).optional() },
      async ({ format }) => {
        try {
          const { generateCliReferenceMarkdown, generateManpage } = await import("../../lib/cli-manpage.js");
          const text = format === "manpage" ? generateManpage() : generateCliReferenceMarkdown();
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_shell_completion")) {
    server.tool(
      "get_shell_completion",
      "Generate bash, zsh, or fish completion script for todos CLI.",
      { shell: z.enum(["bash", "zsh", "fish"]) },
      async ({ shell }) => {
        try {
          const mod = await import("../../lib/cli-completions.js");
          const text = shell === "bash" ? mod.generateBashCompletion()
            : shell === "zsh" ? mod.generateZshCompletion()
            : mod.generateFishCompletion();
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
