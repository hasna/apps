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
          const { loadWorkspaceTrustConfig } = await import("../../lib/workspace-trust.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(loadWorkspaceTrustConfig(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("check_workspace_permission")) {
    server.tool(
      "check_workspace_permission",
      "Check if an operation is allowed for a trust profile or agent.",
      {
        operation: z.string(),
        profile: z.string().optional(),
        agent_id: z.string().optional(),
      },
      async ({ operation, profile, agent_id }) => {
        try {
          const { checkPermission } = await import("../../lib/workspace-trust.js");
          const result = checkPermission(operation as any, { profile, agent_id });
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
      "Add a workspace path to the trusted list.",
      { path: z.string() },
      async ({ path }) => {
        try {
          const { trustWorkspace } = await import("../../lib/workspace-trust.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(trustWorkspace(path), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
