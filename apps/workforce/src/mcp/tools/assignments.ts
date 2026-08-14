import { z } from "zod";
import { assignmentService } from "../../services/index.js";
import type { CreateAssignmentInput } from "../../services/assignments.js";
import { errorResult, jsonResult } from "../compact.js";
import { mcpWriteConfirmationSchema, stripMcpWriteConfirmation } from "../schemas/index.js";
import type { ToolContext, ToolRegistrar } from "../index.js";

export function registerAssignmentTools(server: ToolRegistrar, ctx: ToolContext): void {
  if (ctx.shouldRegisterTool("list_assignments")) {
    server.tool("list_assignments", "List assignments.", { member_id: z.string().optional(), entity_id: z.string().optional(), status: z.enum(["active", "ended"]).optional() }, async (args) => {
      try {
        return jsonResult(assignmentService.listAssignments(args as Record<string, never>, ctx.authCtx));
      } catch (error) {
        return errorResult(ctx.formatError(error));
      }
    });
  }

  if (ctx.shouldRegisterTool("get_assignment")) {
    server.tool("get_assignment", "Get an assignment by id.", { id: z.string() }, async (args) => {
      try {
        return jsonResult(assignmentService.getAssignment(String(args["id"]), ctx.authCtx));
      } catch (error) {
        return errorResult(ctx.formatError(error));
      }
    });
  }

  if (ctx.shouldRegisterTool("create_assignment")) {
    server.tool(
      "create_assignment",
      "Assign a member to an entity/project.",
      { member_id: z.string(), entity_id: z.string(), project: z.string().optional(), role_on_assignment: z.string().optional(), allocation_pct: z.number().optional(), start_date: z.string().optional(), end_date: z.string().optional(), ...mcpWriteConfirmationSchema },
      async (args) => {
        try {
          const input = stripMcpWriteConfirmation(args, "create_assignment") as unknown as CreateAssignmentInput;
          return jsonResult(assignmentService.createAssignment(input, ctx.authCtx));
        } catch (error) {
          return errorResult(ctx.formatError(error));
        }
      },
    );
  }

  if (ctx.shouldRegisterTool("end_assignment")) {
    server.tool("end_assignment", "End an assignment.", { id: z.string(), end_date: z.string().optional(), ...mcpWriteConfirmationSchema }, async (args) => {
      try {
        const clean = stripMcpWriteConfirmation(args, "end_assignment") as Record<string, unknown>;
        return jsonResult(assignmentService.endAssignment(String(clean["id"]), { end_date: clean["end_date"] as string | undefined }, ctx.authCtx));
      } catch (error) {
        return errorResult(ctx.formatError(error));
      }
    });
  }
}
