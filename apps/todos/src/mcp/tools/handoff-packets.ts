import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerHandoffPacketTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("build_handoff_packet")) {
    server.tool(
      "build_handoff_packet",
      "Build offline handoff packet with project/plan context, active tasks, blockers, comments, verification, and next action.",
      {
        agent_id: z.string().optional(),
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
        task_id: z.string().optional(),
      },
      async (params) => {
        try {
          const { buildHandoffPacket } = await import("../../lib/handoff-packets.js");
          const packet = buildHandoffPacket({
            agent_id: params.agent_id,
            project_id: params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined,
            plan_id: params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined,
            task_id: params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(packet, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_handoff_packet")) {
    server.tool(
      "create_handoff_packet",
      "Build and persist a handoff packet locally.",
      {
        agent_id: z.string().optional(),
        project_id: z.string().optional(),
        plan_id: z.string().optional(),
      },
      async (params) => {
        try {
          const { createHandoffPacket } = await import("../../lib/handoff-packets.js");
          const packet = createHandoffPacket({
            agent_id: params.agent_id,
            project_id: params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined,
            plan_id: params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(packet, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("format_handoff_packet")) {
    server.tool(
      "format_handoff_packet",
      "Format a handoff packet as JSON or Markdown.",
      {
        agent_id: z.string().optional(),
        project_id: z.string().optional(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async (params) => {
        try {
          const { buildHandoffPacket, formatHandoffPacket } = await import("../../lib/handoff-packets.js");
          const packet = buildHandoffPacket({
            agent_id: params.agent_id,
            project_id: params.project_id ? resolveId(params.project_id, "projects") ?? params.project_id : undefined,
          });
          return { content: [{ type: "text" as const, text: formatHandoffPacket(packet, params.format ?? "markdown") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
