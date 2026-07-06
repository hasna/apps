import { z } from "zod";
import { memberService } from "../../services/index.js";
import type { CreateMemberInput, UpdateMemberInput } from "../../services/members.js";
import { errorResult, jsonResult } from "../compact.js";
import { mcpWriteConfirmationSchema, stripMcpWriteConfirmation } from "../schemas/index.js";
import type { ToolContext, ToolRegistrar } from "../index.js";

export function registerMemberTools(server: ToolRegistrar, ctx: ToolContext): void {
  if (ctx.shouldRegisterTool("list_members")) {
    server.tool(
      "list_members",
      "List roster members (humans, contractors, agents).",
      { kind: z.enum(["human", "contractor", "agent"]).optional(), status: z.enum(["active", "suspended", "offboarded"]).optional(), owner_id: z.string().optional(), entity_id: z.string().optional() },
      async (args) => {
        try {
          return jsonResult(memberService.listMembers(args as Record<string, never>, ctx.authCtx));
        } catch (error) {
          return errorResult(ctx.formatError(error));
        }
      },
    );
  }

  if (ctx.shouldRegisterTool("get_member")) {
    server.tool("get_member", "Get a member by id.", { id: z.string() }, async (args) => {
      try {
        return jsonResult(memberService.getMember(String(args["id"]), ctx.authCtx));
      } catch (error) {
        return errorResult(ctx.formatError(error));
      }
    });
  }

  if (ctx.shouldRegisterTool("create_member")) {
    server.tool(
      "create_member",
      "Onboard a member. Agents require an owning human (owner_id).",
      {
        kind: z.enum(["human", "contractor", "agent"]),
        name: z.string(),
        home_entity_id: z.string(),
        home_entity_slug: z.string().optional(),
        role: z.string().optional(),
        owner_id: z.string().optional(),
        email: z.string().optional(),
        effective_date: z.string().optional(),
        ...mcpWriteConfirmationSchema,
      },
      async (args) => {
        try {
          const input = stripMcpWriteConfirmation(args, "create_member") as unknown as CreateMemberInput;
          return jsonResult(memberService.createMember(input, ctx.authCtx));
        } catch (error) {
          return errorResult(ctx.formatError(error));
        }
      },
    );
  }

  if (ctx.shouldRegisterTool("update_member")) {
    server.tool(
      "update_member",
      "Update member attributes.",
      { id: z.string(), name: z.string().optional(), role: z.string().optional(), home_entity_slug: z.string().optional(), email: z.string().optional(), owner_id: z.string().optional(), expected_version: z.number().optional(), ...mcpWriteConfirmationSchema },
      async (args) => {
        try {
          const clean = stripMcpWriteConfirmation(args, "update_member") as Record<string, unknown>;
          const id = String(clean["id"]);
          delete clean["id"];
          return jsonResult(memberService.updateMember(id, clean as UpdateMemberInput, ctx.authCtx));
        } catch (error) {
          return errorResult(ctx.formatError(error));
        }
      },
    );
  }
}
