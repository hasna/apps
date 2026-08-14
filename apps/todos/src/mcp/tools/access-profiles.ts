import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerAccessProfileTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("list_access_profiles")) {
    server.tool(
      "list_access_profiles",
      "List local access profiles (read_only, agent_safe, minimal, standard, full, admin).",
      {},
      async () => {
        try {
          const { listAccessProfiles, getHeadlessUsageNotes, resolveAccessProfile } = await import("../../lib/access-profiles.js");
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                active: resolveAccessProfile(),
                profiles: listAccessProfiles(),
                notes: getHeadlessUsageNotes(),
              }, null, 2),
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
