import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerWorkspaceTrustTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("list_workspace_trust_profiles")) {
    server.tool(
      "list_workspace_trust_profiles",
      "List local workspace trust and permission profiles.",
      {},
      async () => {
        try {
          const { listWorkspaceTrustProfiles } = await import("../../lib/workspace-trust.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(listWorkspaceTrustProfiles(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_workspace_permission")) {
    server.tool(
      "check_workspace_permission",
      "Check whether an operation (command/tool/write path) is allowed under the workspace trust profile.",
      {
        path: z.string().optional().describe("Workspace path to evaluate (defaults to cwd)"),
        command: z.string().optional().describe("Shell command to check against the allow/deny lists"),
        tool: z.string().optional().describe("Tool name to check against tool permissions"),
        write_path: z.string().optional().describe("Filesystem path a write would target"),
      },
      async ({ path, command, tool, write_path }) => {
        try {
          const { checkWorkspacePermission } = await import("../../lib/workspace-trust.js");
          const result = checkWorkspacePermission({ path, command, tool, write_path });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("trust_workspace")) {
    server.tool(
      "trust_workspace",
      "Add (or update) a workspace path as trusted.",
      {
        path: z.string(),
        preset: z.enum(["restricted", "readonly", "standard", "trusted"]).optional(),
      },
      async ({ path, preset }) => {
        try {
          const { upsertWorkspaceTrustProfile } = await import("../../lib/workspace-trust.js");
          const profile = upsertWorkspaceTrustProfile({ root: path, trusted: true, preset });
          return { content: [{ type: "text" as const, text: JSON.stringify(profile, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
