import { z } from "zod";
import { exportService } from "../../services/index.js";
import { errorResult, jsonResult } from "../compact.js";
import type { ToolContext, ToolRegistrar } from "../index.js";

export function registerExportTools(server: ToolRegistrar, ctx: ToolContext): void {
  if (ctx.shouldRegisterTool("export_roster")) {
    server.tool(
      "export_roster",
      "Export the payroll/timesheets roster contract for an entity (or all authorized entities).",
      { entity_id: z.string().optional(), include_offboarded: z.boolean().optional() },
      async (args) => {
        try {
          return jsonResult(exportService.exportRoster(args as Record<string, never>, ctx.authCtx));
        } catch (error) {
          return errorResult(ctx.formatError(error));
        }
      },
    );
  }
}
