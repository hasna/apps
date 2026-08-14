import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerRunRecordTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("create_run_record")) {
    server.tool(
      "create_run_record",
      "Create a first-class local run record for agent execution logging.",
      {
        agent_run_id: z.string().optional(),
        agent_id: z.string().optional(),
        objective: z.string().optional(),
        plan_id: z.string().optional(),
        claimed_task_ids: z.array(z.string()).optional(),
      },
      async (params) => {
        try {
          const { createRunRecord } = await import("../../lib/run-records.js");
          const planId = params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined;
          const taskIds = params.claimed_task_ids?.map((id) => resolveId(id, "tasks") ?? id);
          const record = createRunRecord({ ...params, plan_id: planId, claimed_task_ids: taskIds });
          return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("append_run_command")) {
    server.tool(
      "append_run_command",
      "Append a command entry and optional stdout/stderr to a run record (redacted).",
      {
        run_id: z.string(),
        command: z.string(),
        exit_code: z.number().optional(),
        duration_ms: z.number().optional(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
      },
      async ({ run_id, ...rest }) => {
        try {
          const { appendRunCommand } = await import("../../lib/run-records.js");
          const record = appendRunCommand(run_id, rest.command, rest);
          return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_run_record")) {
    server.tool(
      "get_run_record",
      "Get a local run record by ID.",
      {
        run_id: z.string(),
        format: z.enum(["json", "markdown"]).optional(),
      },
      async ({ run_id, format }) => {
        try {
          const { getRunRecord, formatRunRecordMarkdown } = await import("../../lib/run-records.js");
          const record = getRunRecord(run_id);
          if (!record) return { content: [{ type: "text" as const, text: "Run record not found." }], isError: true };
          const text = format === "markdown" ? formatRunRecordMarkdown(record) : JSON.stringify(record, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_run_records")) {
    server.tool(
      "list_run_records",
      "List local run records with optional filters.",
      {
        agent_run_id: z.string().optional(),
        agent_id: z.string().optional(),
        plan_id: z.string().optional(),
        status: z.enum(["active", "completed", "failed", "archived"]).optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { listRunRecords } = await import("../../lib/run-records.js");
          const planId = params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined;
          const records = listRunRecords({ ...params, plan_id: planId });
          return { content: [{ type: "text" as const, text: JSON.stringify(records, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("export_run_replay")) {
    server.tool(
      "export_run_replay",
      "Export a run record replay bundle to local JSON.",
      {
        run_id: z.string(),
        output_path: z.string().optional(),
      },
      async ({ run_id, output_path }) => {
        try {
          const { exportRunReplay } = await import("../../lib/run-records.js");
          const result = exportRunReplay(run_id, output_path);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
