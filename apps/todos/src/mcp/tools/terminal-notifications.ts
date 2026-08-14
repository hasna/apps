import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerTerminalNotificationTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("list_watch_rules")) {
    server.tool(
      "list_watch_rules",
      "List local terminal watch rules for task/plan/run/approval events.",
      {
        project_id: z.string().optional(),
        enabled: z.boolean().optional(),
      },
      async ({ project_id, enabled }) => {
        try {
          const { listWatchRules } = await import("../../lib/terminal-notifications.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          return { content: [{ type: "text" as const, text: JSON.stringify(listWatchRules({ project_id: projectId, enabled }), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_watch_rule")) {
    server.tool(
      "create_watch_rule",
      "Create a local terminal watch rule.",
      {
        name: z.string(),
        events: z.array(z.string()).optional(),
        project_id: z.string().optional(),
        project_path_pattern: z.string().optional(),
        agent_id: z.string().optional(),
        priority_min: z.enum(["low", "medium", "high", "critical"]).optional(),
        quiet: z.boolean().optional(),
        bell: z.boolean().optional(),
        desktop_notify: z.boolean().optional(),
        hook_command: z.string().optional(),
        enabled: z.boolean().optional(),
      },
      async ({ project_id, agent_id, events, ...rest }) => {
        try {
          const { createWatchRule } = await import("../../lib/terminal-notifications.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          const agentId = agent_id ? resolveId(agent_id, "agents") ?? agent_id : undefined;
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(createWatchRule({
                ...rest,
                project_id: projectId,
                agent_id: agentId,
                events: events as any,
              }), null, 2),
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("update_watch_rule")) {
    server.tool(
      "update_watch_rule",
      "Update a local terminal watch rule.",
      {
        id: z.string(),
        name: z.string().optional(),
        events: z.array(z.string()).optional(),
        enabled: z.boolean().optional(),
        quiet: z.boolean().optional(),
        bell: z.boolean().optional(),
        desktop_notify: z.boolean().optional(),
        hook_command: z.string().optional(),
      },
      async ({ id, ...rest }) => {
        try {
          const { updateWatchRule } = await import("../../lib/terminal-notifications.js");
          const ruleId = resolveId(id, "watch_rules") ?? id;
          return { content: [{ type: "text" as const, text: JSON.stringify(updateWatchRule({ id: ruleId, ...rest, events: rest.events as any }), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("delete_watch_rule")) {
    server.tool(
      "delete_watch_rule",
      "Delete a local terminal watch rule by ID.",
      { id: z.string() },
      async ({ id }) => {
        try {
          const { deleteWatchRule } = await import("../../lib/terminal-notifications.js");
          const ruleId = resolveId(id, "watch_rules") ?? id;
          return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: deleteWatchRule(ruleId) }, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("poll_watch_notifications")) {
    server.tool(
      "poll_watch_notifications",
      "Poll local DB for watch events and emit terminal notifications.",
      {
        project_id: z.string().optional(),
        agent_id: z.string().optional(),
        project_path: z.string().optional(),
        since: z.string().optional(),
        dry_run: z.boolean().optional(),
        quiet: z.boolean().optional(),
      },
      async ({ project_id, agent_id, ...rest }) => {
        try {
          const { pollWatchNotifications } = await import("../../lib/terminal-notifications.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          const agentId = agent_id ? resolveId(agent_id, "agents") ?? agent_id : undefined;
          const result = pollWatchNotifications({
            ...rest,
            project_id: projectId,
            agent_id: agentId,
            quiet: true,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_watch_status")) {
    server.tool(
      "get_watch_status",
      "Summary of watch cursor, rules, and preferences.",
      {},
      async () => {
        try {
          const { getWatchStatus } = await import("../../lib/terminal-notifications.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(getWatchStatus(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_watch_preferences")) {
    server.tool(
      "get_watch_preferences",
      "Get local terminal watch preferences (interval, bell, quiet, desktop notify).",
      {},
      async () => {
        try {
          const { getWatchPreferences } = await import("../../lib/terminal-notifications.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(getWatchPreferences(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_watch_preferences")) {
    server.tool(
      "set_watch_preferences",
      "Update local terminal watch preferences.",
      {
        enabled: z.boolean().optional(),
        poll_interval_seconds: z.number().optional(),
        bell: z.boolean().optional(),
        desktop_notify: z.boolean().optional(),
        quiet: z.boolean().optional(),
        due_soon_hours: z.number().optional(),
        stale_minutes: z.number().optional(),
        stale_lock_minutes: z.number().optional(),
      },
      async (params) => {
        try {
          const { setWatchPreferences } = await import("../../lib/terminal-notifications.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(setWatchPreferences(params), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
