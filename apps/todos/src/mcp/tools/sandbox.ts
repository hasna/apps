import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerSandboxTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("list_sandbox_profiles")) {
    server.tool(
      "list_sandbox_profiles",
      "List local runner sandbox profiles with command allow/deny lists.",
      {},
      async () => {
        try {
          const { loadSandboxProfiles } = await import("../../lib/sandbox-profiles.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(loadSandboxProfiles(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_sandbox_command")) {
    server.tool(
      "check_sandbox_command",
      "Check if a command is allowed by a local sandbox profile (dry-run explain).",
      {
        command: z.string(),
        profile: z.string().optional(),
        dry_run: z.boolean().optional(),
        cwd: z.string().optional(),
      },
      async ({ command, profile, dry_run, cwd }) => {
        try {
          const { checkSandboxCommand } = await import("../../lib/sandbox-profiles.js");
          const result = checkSandboxCommand({ command, cwd }, profile ?? "default", dry_run);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
