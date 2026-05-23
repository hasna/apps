import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerVerificationTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("list_verification_providers")) {
    server.tool(
      "list_verification_providers",
      "List locally configured verification providers (shell, testbox, ci_snapshot, manual).",
      {},
      async () => {
        try {
          const { loadVerificationProviders } = await import("../../lib/verification-providers.js");
          const providers = loadVerificationProviders();
          const text = providers.map((p) => `${p.name} (${p.type})${p.command ? ` — ${p.command}` : ""}`).join("\n");
          return { content: [{ type: "text" as const, text: text || "No providers configured." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("run_verification")) {
    server.tool(
      "run_verification",
      "Run a local verification provider and store normalized evidence record.",
      {
        provider: z.string(),
        task_id: z.string().optional(),
        note: z.string().optional().describe("Manual verification note"),
        evidence_path: z.string().optional(),
        snapshot_path: z.string().optional(),
        cwd: z.string().optional(),
      },
      async (params) => {
        try {
          const { runVerification } = await import("../../lib/verification-providers.js");
          const taskId = params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined;
          const record = runVerification({ ...params, task_id: taskId });
          return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_verification_records")) {
    server.tool(
      "list_verification_records",
      "List stored verification evidence records.",
      {
        task_id: z.string().optional(),
        provider: z.string().optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { listVerificationRecords } = await import("../../lib/verification-providers.js");
          const taskId = params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined;
          const records = listVerificationRecords({ ...params, task_id: taskId });
          return { content: [{ type: "text" as const, text: JSON.stringify(records, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
