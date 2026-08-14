import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerNotificationReminderTools(
  server: McpServer,
  { shouldRegisterTool, resolveId, formatError }: Helpers,
): void {
  if (shouldRegisterTool("list_reminders")) {
    server.tool(
      "list_reminders",
      "List local notification reminders (due-date, SLA, custom).",
      {
        status: z.enum(["pending", "fired", "dismissed", "snoozed"]).optional(),
        reminder_type: z.enum(["due_soon", "due_overdue", "sla_warning", "sla_breach", "custom"]).optional(),
        project_id: z.string().optional(),
        agent_id: z.string().optional(),
        limit: z.number().optional(),
      },
      async ({ status, reminder_type, project_id, agent_id, limit }) => {
        try {
          const { listReminders } = await import("../../lib/notification-reminders.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          const agentId = agent_id ? resolveId(agent_id, "agents") ?? agent_id : undefined;
          const reminders = listReminders({ status, reminder_type, project_id: projectId, agent_id: agentId, limit });
          return { content: [{ type: "text" as const, text: JSON.stringify(reminders, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("scan_reminders")) {
    server.tool(
      "scan_reminders",
      "Scan tasks for due-date and SLA reminders; upsert local reminder records.",
      {
        project_id: z.string().optional(),
        agent_id: z.string().optional(),
      },
      async ({ project_id, agent_id }) => {
        try {
          const { scanReminders } = await import("../../lib/notification-reminders.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          const agentId = agent_id ? resolveId(agent_id, "agents") ?? agent_id : undefined;
          return { content: [{ type: "text" as const, text: JSON.stringify(scanReminders({ project_id: projectId, agent_id: agentId }), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("process_reminders")) {
    server.tool(
      "process_reminders",
      "Fire due local reminders; optional desktop notify-send when enabled.",
      {
        desktop: z.boolean().optional(),
        project_id: z.string().optional(),
        agent_id: z.string().optional(),
      },
      async ({ desktop, project_id, agent_id }) => {
        try {
          const { processDueReminders } = await import("../../lib/notification-reminders.js");
          const projectId = project_id ? resolveId(project_id, "projects") ?? project_id : undefined;
          const agentId = agent_id ? resolveId(agent_id, "agents") ?? agent_id : undefined;
          return { content: [{ type: "text" as const, text: JSON.stringify(processDueReminders({ desktop, project_id: projectId, agent_id: agentId }), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("create_reminder")) {
    server.tool(
      "create_reminder",
      "Create a custom local reminder.",
      {
        title: z.string(),
        trigger_at: z.string(),
        task_id: z.string().optional(),
        message: z.string().optional(),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      },
      async ({ task_id, ...rest }) => {
        try {
          const { createReminder } = await import("../../lib/notification-reminders.js");
          const id = task_id ? resolveId(task_id, "tasks") ?? task_id : undefined;
          return { content: [{ type: "text" as const, text: JSON.stringify(createReminder({ ...rest, task_id: id }), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("dismiss_reminder")) {
    server.tool(
      "dismiss_reminder",
      "Dismiss a local reminder by ID.",
      { id: z.string() },
      async ({ id }) => {
        try {
          const { dismissReminder } = await import("../../lib/notification-reminders.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(dismissReminder(id), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("snooze_reminder")) {
    server.tool(
      "snooze_reminder",
      "Snooze a reminder until a later ISO datetime.",
      { id: z.string(), until: z.string() },
      async ({ id, until }) => {
        try {
          const { snoozeReminder } = await import("../../lib/notification-reminders.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(snoozeReminder(id, until), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_reminder_summary")) {
    server.tool(
      "get_reminder_summary",
      "Summary counts for pending, due, snoozed, and fired reminders.",
      {},
      async () => {
        try {
          const { getReminderSummary } = await import("../../lib/notification-reminders.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(getReminderSummary(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_reminder_preferences")) {
    server.tool(
      "get_reminder_preferences",
      "Get local reminder preferences (due-soon window, SLA warning lead, desktop notify).",
      {},
      async () => {
        try {
          const { getReminderPreferences } = await import("../../lib/notification-reminders.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(getReminderPreferences(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("set_reminder_preferences")) {
    server.tool(
      "set_reminder_preferences",
      "Update local reminder preferences.",
      {
        due_soon_hours: z.number().optional(),
        sla_warning_minutes: z.number().optional(),
        enabled: z.boolean().optional(),
        desktop_notify: z.boolean().optional(),
      },
      async (params) => {
        try {
          const { setReminderPreferences } = await import("../../lib/notification-reminders.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(setReminderPreferences(params), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
