import { z } from "zod";
import { capabilityService } from "../../services/index.js";
import type { AddCapabilityInput } from "../../services/capabilities.js";
import { errorResult, jsonResult } from "../compact.js";
import { mcpWriteConfirmationSchema, stripMcpWriteConfirmation } from "../schemas/index.js";
import type { ToolContext, ToolRegistrar } from "../index.js";

export function registerCapabilityTools(server: ToolRegistrar, ctx: ToolContext): void {
  if (ctx.shouldRegisterTool("list_capabilities")) {
    server.tool("list_capabilities", "List a member's capabilities.", { member_id: z.string() }, async (args) => {
      try {
        return jsonResult(capabilityService.listCapabilities(String(args["member_id"]), ctx.authCtx));
      } catch (error) {
        return errorResult(ctx.formatError(error));
      }
    });
  }

  if (ctx.shouldRegisterTool("add_capability")) {
    server.tool(
      "add_capability",
      "Add a capability/skill to a member.",
      { member_id: z.string(), name: z.string(), category: z.string().optional(), level: z.enum(["novice", "intermediate", "advanced", "expert"]).optional(), notes: z.string().optional(), ...mcpWriteConfirmationSchema },
      async (args) => {
        try {
          const input = stripMcpWriteConfirmation(args, "add_capability") as unknown as AddCapabilityInput;
          return jsonResult(capabilityService.addCapability(input, ctx.authCtx));
        } catch (error) {
          return errorResult(ctx.formatError(error));
        }
      },
    );
  }

  if (ctx.shouldRegisterTool("remove_capability")) {
    server.tool("remove_capability", "Remove a capability by id.", { id: z.string(), ...mcpWriteConfirmationSchema }, async (args) => {
      try {
        const clean = stripMcpWriteConfirmation(args, "remove_capability") as Record<string, unknown>;
        return jsonResult(capabilityService.removeCapability(String(clean["id"]), ctx.authCtx));
      } catch (error) {
        return errorResult(ctx.formatError(error));
      }
    });
  }
}
