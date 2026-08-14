import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerParityTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("get_cli_mcp_parity")) {
    server.tool(
      "get_cli_mcp_parity",
      "Get CLI ↔ MCP parity manifest report with matched operations and documented gaps.",
      {
        domain: z.string().optional(),
        format: z.enum(["json", "text"]).optional(),
      },
      async ({ domain, format }) => {
        try {
          const { getParityReport, CLI_MCP_PARITY_MANIFEST } = await import("../../lib/cli-mcp-parity.js");
          const report = getParityReport();
          const entries = domain
            ? CLI_MCP_PARITY_MANIFEST.filter((e) => e.domain === domain)
            : report.entries;

          if (format === "text") {
            const lines = entries.map((e) =>
              `${e.domain}/${e.operation}: cli=${e.cli ?? "-"} mcp=${e.mcp ?? "-"}${e.gap ? ` GAP: ${e.gap}` : ""}`,
            );
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }

          return { content: [{ type: "text" as const, text: JSON.stringify({ ...report, entries }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
