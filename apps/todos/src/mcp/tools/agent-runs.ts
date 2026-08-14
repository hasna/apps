import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerAgentRunTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("list_agent_adapters")) {
    server.tool(
      "list_agent_adapters",
      "List locally configured agent run adapters (stdio, tmux, script).",
      {},
      async () => {
        try {
          const { loadAgentAdapters } = await import("../../lib/agent-run-dispatcher.js");
          const adapters = loadAgentAdapters();
          const text = adapters.map((a) => `${a.name} (${a.type})${a.description ? ` — ${a.description}` : ""}`).join("\n");
          return { content: [{ type: "text" as const, text: text || "No adapters configured." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("enqueue_agent_run")) {
    server.tool(
      "enqueue_agent_run",
      "Queue a local agent run for a task or plan.",
      {
        task_id: z.string().optional(),
        plan_id: z.string().optional(),
        adapter: z.string(),
        agent_id: z.string().optional(),
        max_retries: z.number().optional(),
      },
      async (params) => {
        try {
          const { enqueueAgentRun } = await import("../../lib/agent-run-dispatcher.js");
          const taskId = params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined;
          const planId = params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined;
          const run = enqueueAgentRun({ ...params, task_id: taskId, plan_id: planId });
          return { content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("claim_next_agent_run")) {
    server.tool(
      "claim_next_agent_run",
      "Atomically claim the next queued local agent run.",
      {
        agent_id: z.string(),
        adapter: z.string().optional(),
      },
      async ({ agent_id, adapter }) => {
        try {
          const { claimNextAgentRun } = await import("../../lib/agent-run-dispatcher.js");
          const run = claimNextAgentRun(agent_id, { adapter });
          if (!run) {
            return { content: [{ type: "text" as const, text: "No queued agent runs available." }] };
          }
          return { content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_agent_runs")) {
    server.tool(
      "list_agent_runs",
      "List local agent runs with optional status/adapter filters.",
      {
        status: z.string().optional(),
        adapter: z.string().optional(),
        agent_id: z.string().optional(),
        task_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { listAgentRuns } = await import("../../lib/agent-run-dispatcher.js");
          const taskId = params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined;
          const runs = listAgentRuns({ ...params, task_id: taskId } as any);
          return { content: [{ type: "text" as const, text: JSON.stringify(runs, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("complete_agent_run")) {
    server.tool(
      "complete_agent_run",
      "Mark a running agent run as completed with optional evidence.",
      {
        run_id: z.string(),
        evidence: z.record(z.unknown()).optional(),
      },
      async ({ run_id, evidence }) => {
        try {
          const { completeAgentRun } = await import("../../lib/agent-run-dispatcher.js");
          const run = completeAgentRun(run_id, evidence ?? {});
          return { content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("fail_agent_run")) {
    server.tool(
      "fail_agent_run",
      "Mark an agent run as failed (auto-retries if configured).",
      {
        run_id: z.string(),
        error: z.string(),
        retry: z.boolean().optional(),
      },
      async ({ run_id, error, retry }) => {
        try {
          const { failAgentRun } = await import("../../lib/agent-run-dispatcher.js");
          const run = failAgentRun(run_id, error, { retry });
          return { content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("cancel_agent_run")) {
    server.tool(
      "cancel_agent_run",
      "Cancel a queued or running agent run.",
      { run_id: z.string() },
      async ({ run_id }) => {
        try {
          const { cancelAgentRun } = await import("../../lib/agent-run-dispatcher.js");
          const run = cancelAgentRun(run_id);
          return { content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("retry_agent_run")) {
    server.tool(
      "retry_agent_run",
      "Manually re-queue a failed or cancelled agent run.",
      { run_id: z.string() },
      async ({ run_id }) => {
        try {
          const { retryAgentRun } = await import("../../lib/agent-run-dispatcher.js");
          const run = retryAgentRun(run_id);
          return { content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
