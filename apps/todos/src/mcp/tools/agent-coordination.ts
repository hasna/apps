import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerAgentCoordinationTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("acquire_task_lease")) {
    server.tool(
      "acquire_task_lease",
      "Atomically acquire a task lease with TTL for multi-agent coordination.",
      {
        task_id: z.string(),
        agent_id: z.string(),
        ttl_minutes: z.number().optional(),
      },
      async ({ task_id, agent_id, ttl_minutes }) => {
        try {
          const { acquireTaskLease } = await import("../../lib/agent-coordination.js");
          const taskId = resolveId(task_id, "tasks") ?? task_id;
          return { content: [{ type: "text" as const, text: JSON.stringify(acquireTaskLease(taskId, agent_id, ttl_minutes), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("renew_task_lease")) {
    server.tool(
      "renew_task_lease",
      "Renew a task lease heartbeat and extend TTL.",
      { task_id: z.string(), agent_id: z.string(), ttl_minutes: z.number().optional() },
      async ({ task_id, agent_id, ttl_minutes }) => {
        try {
          const { renewTaskLease } = await import("../../lib/agent-coordination.js");
          const taskId = resolveId(task_id, "tasks") ?? task_id;
          return { content: [{ type: "text" as const, text: JSON.stringify(renewTaskLease(taskId, agent_id, ttl_minutes), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("release_task_lease")) {
    server.tool(
      "release_task_lease",
      "Release a held task lease.",
      { task_id: z.string(), agent_id: z.string() },
      async ({ task_id, agent_id }) => {
        try {
          const { releaseTaskLease } = await import("../../lib/agent-coordination.js");
          const taskId = resolveId(task_id, "tasks") ?? task_id;
          releaseTaskLease(taskId, agent_id);
          return { content: [{ type: "text" as const, text: "Lease released." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("steal_task_lease")) {
    server.tool(
      "steal_task_lease",
      "Safely steal a stale or expired task lease.",
      {
        task_id: z.string(),
        agent_id: z.string(),
        force: z.boolean().optional(),
        stale_minutes: z.number().optional(),
        reason: z.string().optional(),
      },
      async (params) => {
        try {
          const { stealTaskLease } = await import("../../lib/agent-coordination.js");
          const taskId = resolveId(params.task_id, "tasks") ?? params.task_id;
          return { content: [{ type: "text" as const, text: JSON.stringify(stealTaskLease(taskId, params.agent_id, params), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("recover_stale_leases")) {
    server.tool(
      "recover_stale_leases",
      "Recover expired/stale task leases and optionally reclaim work for an agent.",
      {
        reclaim_agent: z.string().optional(),
        stale_minutes: z.number().optional(),
      },
      async (params) => {
        try {
          const { recoverStaleLeases } = await import("../../lib/agent-coordination.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(recoverStaleLeases(params), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_active_leases")) {
    server.tool(
      "list_active_leases",
      "List active task leases, optionally filtered by agent.",
      { agent_id: z.string().optional() },
      async ({ agent_id }) => {
        try {
          const { listActiveLeases } = await import("../../lib/agent-coordination.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(listActiveLeases(agent_id), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
