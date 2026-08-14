import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerMachineTopologyTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("get_machine_topology")) {
    server.tool(
      "get_machine_topology",
      "Local machine registry and topology diagnostics: machines, path overrides, agents, stale locks.",
      {},
      async () => {
        try {
          const { buildMachineTopologyReport } = await import("../../lib/machine-topology.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(buildMachineTopologyReport(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("register_local_machine")) {
    server.tool(
      "register_local_machine",
      "Register or refresh the local machine in the registry.",
      {},
      async () => {
        try {
          const { registerLocalMachine } = await import("../../lib/machine-topology.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(registerLocalMachine(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
