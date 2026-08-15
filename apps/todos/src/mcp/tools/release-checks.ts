import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerReleaseCheckTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("run_release_checks")) {
    server.tool(
      "run_release_checks",
      "Run public package release and supply-chain hardening checks.",
      {
        skip_dist_scan: z.boolean().optional(),
        format: z.enum(["json", "text"]).optional(),
      },
      async ({ skip_dist_scan, format }) => {
        try {
          const { runReleaseChecks, formatReleaseCheckReport } = await import("../../lib/release-checks.js");
          const report = runReleaseChecks({ skip_dist_scan });
          const text = format === "text" ? formatReleaseCheckReport(report) : JSON.stringify(report, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  server.resource(
    "todos://release-workflow",
    "Local @hasna/todos publish workflow documentation",
    async () => {
      const { getReleaseWorkflowDocs } = await import("../../lib/release-checks.js");
      return {
        contents: [{
          uri: "todos://release-workflow",
          mimeType: "text/markdown",
          text: getReleaseWorkflowDocs(),
        }],
      };
    },
  );
}
