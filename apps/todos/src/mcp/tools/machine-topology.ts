import { getTodosCloudClient } from "../../cli/cloud-router.js";
import { cloudMachineAction, cloudMachines, localMachineOptions } from "../../cli/machine-api.js";
import { hostname, platform, arch } from "node:os";
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
          const cloud = getTodosCloudClient();
          if (cloud) return { content: [{ type: "text" as const, text: JSON.stringify({ source: "api", filesystem_checked: false, machines: await cloudMachines(cloud) }) }] };
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
          const cloud = getTodosCloudClient();
          if (cloud) return { content: [{ type: "text" as const, text: JSON.stringify(await cloudMachineAction(cloud, { action: "heartbeat", name: process.env.HASNA_TODOS_MACHINE_NAME ?? process.env.TODOS_MACHINE_NAME ?? hostname(), options: localMachineOptions({ hostname: hostname(), platform: platform(), arch: arch() }) })) }] };
          const { registerLocalMachine } = await import("../../lib/machine-topology.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(registerLocalMachine(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
