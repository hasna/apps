import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerAgentAdapterDocTools(
  server: McpServer,
  { shouldRegisterTool, formatError }: Helpers,
): void {
  if (shouldRegisterTool("list_agent_adapter_docs")) {
    server.tool(
      "list_agent_adapter_docs",
      "List first-party local adapter docs for Codex, Claude Code, and Takumi.",
      {},
      async () => {
        try {
          const { listAgentAdapterDocs } = await import("../../lib/agent-adapter-docs.js");
          const docs = listAgentAdapterDocs().map((d) => ({
            host: d.host,
            display_name: d.display_name,
            install: d.install.bun,
            mcp_register: d.mcp.register_cli,
            recommended_profile: d.mcp.recommended_profile,
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(docs, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_agent_adapter_doc")) {
    server.tool(
      "get_agent_adapter_doc",
      "Get full local adapter doc for codex, claude-code, or takumi.",
      {
        host: z.enum(["codex", "claude-code", "takumi", "claude"]).describe("Agent host"),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ host, format }) => {
        try {
          const { getAgentAdapterDoc, renderAdapterDocMarkdown } = await import("../../lib/agent-adapter-docs.js");
          const doc = getAgentAdapterDoc(host);
          if (!doc) {
            return { content: [{ type: "text" as const, text: `Unknown adapter host: ${host}` }], isError: true };
          }
          if (format === "markdown") {
            return { content: [{ type: "text" as const, text: renderAdapterDocMarkdown(host)! }] };
          }
          return { content: [{ type: "text" as const, text: JSON.stringify(doc, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  server.resource(
    "todos://adapter-docs",
    "Local adapter docs for Codex, Claude Code, and Takumi (Markdown)",
    async () => {
      const { renderAllAdapterDocsMarkdown } = await import("../../lib/agent-adapter-docs.js");
      return {
        contents: [{
          uri: "todos://adapter-docs",
          mimeType: "text/markdown",
          text: renderAllAdapterDocsMarkdown(),
        }],
      };
    },
  );
}
