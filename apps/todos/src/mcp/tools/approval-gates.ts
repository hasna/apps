import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerApprovalGateTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("request_approval")) {
    server.tool(
      "request_approval",
      "Request approval for task start, completion, checkpoint, or plan step.",
      {
        task_id: z.string(),
        gate_type: z.enum(["start", "complete", "checkpoint", "plan_step"]),
        checkpoint_step: z.string().optional(),
        note: z.string().optional(),
        requested_by: z.string().optional(),
      },
      async (params) => {
        try {
          const { requestApproval } = await import("../../lib/approval-gates.js");
          const taskId = resolveId(params.task_id, "tasks") ?? params.task_id;
          const req = requestApproval({ ...params, task_id: taskId });
          return { content: [{ type: "text" as const, text: JSON.stringify(req, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("approve_gate")) {
    server.tool(
      "approve_gate",
      "Approve a pending approval gate request.",
      {
        request_id: z.string(),
        reviewed_by: z.string(),
        review_note: z.string().optional(),
      },
      async ({ request_id, reviewed_by, review_note }) => {
        try {
          const { approveGate } = await import("../../lib/approval-gates.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(approveGate(request_id, reviewed_by, review_note), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("reject_gate")) {
    server.tool(
      "reject_gate",
      "Reject a pending approval gate request.",
      {
        request_id: z.string(),
        reviewed_by: z.string(),
        review_note: z.string().optional(),
      },
      async ({ request_id, reviewed_by, review_note }) => {
        try {
          const { rejectGate } = await import("../../lib/approval-gates.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(rejectGate(request_id, reviewed_by, review_note), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_pending_approvals")) {
    server.tool(
      "list_pending_approvals",
      "List pending approval gate requests.",
      {
        task_id: z.string().optional(),
        plan_id: z.string().optional(),
        gate_type: z.string().optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { listPendingApprovals } = await import("../../lib/approval-gates.js");
          const taskId = params.task_id ? resolveId(params.task_id, "tasks") ?? params.task_id : undefined;
          const planId = params.plan_id ? resolveId(params.plan_id, "plans") ?? params.plan_id : undefined;
          return { content: [{ type: "text" as const, text: JSON.stringify(listPendingApprovals({ ...params, task_id: taskId, plan_id: planId } as any), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_task_gate_status")) {
    server.tool(
      "get_task_gate_status",
      "Get blocked/ready status for task start and completion gates.",
      { task_id: z.string() },
      async ({ task_id }) => {
        try {
          const { getTaskGateStatus } = await import("../../lib/approval-gates.js");
          const taskId = resolveId(task_id, "tasks") ?? task_id;
          return { content: [{ type: "text" as const, text: JSON.stringify(getTaskGateStatus(taskId), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_manual_checkpoint")) {
    server.tool(
      "create_manual_checkpoint",
      "Create a manual checkpoint on a task, optionally requiring approval.",
      {
        task_id: z.string(),
        step: z.string(),
        requires_approval: z.boolean().optional(),
        requested_by: z.string().optional(),
        note: z.string().optional(),
      },
      async (params) => {
        try {
          const { createManualCheckpoint } = await import("../../lib/approval-gates.js");
          const taskId = resolveId(params.task_id, "tasks") ?? params.task_id;
          const result = createManualCheckpoint(taskId, params.step, params);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
