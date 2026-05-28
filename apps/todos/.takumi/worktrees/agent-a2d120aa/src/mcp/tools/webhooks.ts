import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerWebhookTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("create_webhook")) {
    server.tool(
      "create_webhook",
      "Register a webhook for task change events. Optionally scope to a project, task list, agent, or specific task.",
      {
        url: z.string(),
        events: z.array(z.string()).optional().describe("Event types to subscribe to (empty = all). E.g. task.created, task.completed, task.failed, task.started, task.assigned, task.status_changed"),
        secret: z.string().optional().describe("HMAC secret for signing webhook payloads"),
        project_id: z.string().optional().describe("Only fire for events in this project"),
        task_list_id: z.string().optional().describe("Only fire for events in this task list"),
        agent_id: z.string().optional().describe("Only fire for events involving this agent"),
        task_id: z.string().optional().describe("Only fire for events on this specific task"),
      },
      async (params) => {
        try {
          const { createWebhook, validateWebhookUrl } = await import("../../db/webhooks.js");
          validateWebhookUrl(params.url);
          const wh = createWebhook(params);
          const scope = [wh.project_id && `project:${wh.project_id}`, wh.task_list_id && `list:${wh.task_list_id}`, wh.agent_id && `agent:${wh.agent_id}`, wh.task_id && `task:${wh.task_id}`].filter(Boolean).join(", ");
          return { content: [{ type: "text" as const, text: `Webhook created: ${wh.id.slice(0, 8)} | ${wh.url} | events: ${wh.events.length === 0 ? "all" : wh.events.join(",")}${scope ? ` | scope: ${scope}` : ""}` }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("list_webhooks")) {
    server.tool(
      "list_webhooks",
      "List all registered webhooks",
      {},
      async () => {
        try {
          const { listWebhooks } = await import("../../db/webhooks.js");
          const webhooks = listWebhooks();
          if (webhooks.length === 0) return { content: [{ type: "text" as const, text: "No webhooks registered." }] };
          const text = webhooks.map(w => `${w.id.slice(0, 8)} | ${w.active ? "active" : "inactive"} | ${w.url} | events: ${w.events.length === 0 ? "all" : w.events.join(",")}`).join("\n");
          return { content: [{ type: "text" as const, text: `${webhooks.length} webhook(s):\n${text}` }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }

  if (shouldRegisterTool("delete_webhook")) {
    server.tool(
      "delete_webhook",
      "Delete a webhook by ID.",
      { id: z.string() },
      async ({ id }) => {
        try {
          const { deleteWebhook } = await import("../../db/webhooks.js");
          const deleted = deleteWebhook(id);
          return { content: [{ type: "text" as const, text: deleted ? "Webhook deleted." : "Webhook not found." }] };
        } catch (e) { return { content: [{ type: "text" as const, text: formatError(e) }], isError: true }; }
      },
    );
  }
}
