import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerActivityAuditTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("list_activity")) {
    server.tool(
      "list_activity",
      "List append-only activity log records with optional filters.",
      {
        entity_type: z.enum(["task", "project", "plan", "agent_run", "run_record", "comment", "session"]).optional(),
        entity_id: z.string().optional(),
        actor_id: z.string().optional(),
        since: z.string().optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { listActivity } = await import("../../lib/activity-audit.js");
          let entityId = params.entity_id;
          if (entityId && params.entity_type === "task") {
            entityId = resolveId(entityId, "tasks") ?? entityId;
          }
          const records = listActivity({ ...params, entity_id: entityId });
          return { content: [{ type: "text" as const, text: JSON.stringify(records, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_activity_timeline")) {
    server.tool(
      "get_activity_timeline",
      "Get chronological activity timeline for an entity.",
      {
        entity_type: z.enum(["task", "project", "plan", "agent_run", "run_record", "comment", "session"]),
        entity_id: z.string(),
      },
      async ({ entity_type, entity_id }) => {
        try {
          const { getActivityTimeline } = await import("../../lib/activity-audit.js");
          let id = entity_id;
          if (entity_type === "task") id = resolveId(entity_id, "tasks") ?? entity_id;
          const timeline = getActivityTimeline(entity_type, id);
          return { content: [{ type: "text" as const, text: JSON.stringify(timeline, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("export_activity_log")) {
    server.tool(
      "export_activity_log",
      "Export redacted activity log records as JSON bundle.",
      {
        entity_type: z.enum(["task", "project", "plan", "agent_run", "run_record", "comment", "session"]).optional(),
        entity_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async (params) => {
        try {
          const { exportActivityLog } = await import("../../lib/activity-audit.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(exportActivityLog(params), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
