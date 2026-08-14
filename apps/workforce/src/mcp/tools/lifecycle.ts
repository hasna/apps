import { z } from "zod";
import { lifecycleService } from "../../services/index.js";
import { errorResult, jsonResult } from "../compact.js";
import { mcpWriteConfirmationSchema, stripMcpWriteConfirmation } from "../schemas/index.js";
import type { ToolContext, ToolRegistrar } from "../index.js";

export function registerLifecycleTools(server: ToolRegistrar, ctx: ToolContext): void {
  if (ctx.shouldRegisterTool("list_member_lifecycle")) {
    server.tool("list_member_lifecycle", "List a member's lifecycle (joiner-mover-leaver) events.", { member_id: z.string() }, async (args) => {
      try {
        return jsonResult(lifecycleService.listMemberLifecycle(String(args["member_id"]), ctx.authCtx));
      } catch (error) {
        return errorResult(ctx.formatError(error));
      }
    });
  }

  if (ctx.shouldRegisterTool("record_role_change")) {
    server.tool(
      "record_role_change",
      "Record a role change (mover event).",
      { member_id: z.string(), to_role: z.string(), effective_date: z.string().optional(), reason: z.string().optional(), ...mcpWriteConfirmationSchema },
      async (args) => {
        try {
          const clean = stripMcpWriteConfirmation(args, "record_role_change") as Record<string, unknown>;
          return jsonResult(lifecycleService.recordRoleChange(clean as never, ctx.authCtx));
        } catch (error) {
          return errorResult(ctx.formatError(error));
        }
      },
    );
  }

  const statusTool = (name: "suspend_member" | "reactivate_member" | "offboard_member", fn: keyof typeof lifecycleService, desc: string) => {
    if (!ctx.shouldRegisterTool(name)) return;
    server.tool(name, desc, { member_id: z.string(), effective_date: z.string().optional(), reason: z.string().optional(), ...mcpWriteConfirmationSchema }, async (args) => {
      try {
        const clean = stripMcpWriteConfirmation(args, name) as Record<string, unknown>;
        const handler = lifecycleService[fn] as (input: unknown, c: unknown) => unknown;
        return jsonResult(handler(clean, ctx.authCtx));
      } catch (error) {
        return errorResult(ctx.formatError(error));
      }
    });
  };

  statusTool("suspend_member", "suspendMember", "Suspend a member.");
  statusTool("reactivate_member", "reactivateMember", "Reactivate a suspended member.");
  statusTool("offboard_member", "offboardMember", "Offboard a member (leaver event).");

  if (ctx.shouldRegisterTool("verify_lifecycle_audit")) {
    server.tool("verify_lifecycle_audit", "Verify the tamper-evident lifecycle audit chain (admin).", {}, async () => {
      try {
        return jsonResult(lifecycleService.verifyLifecycleAudit(ctx.authCtx));
      } catch (error) {
        return errorResult(ctx.formatError(error));
      }
    });
  }
}
