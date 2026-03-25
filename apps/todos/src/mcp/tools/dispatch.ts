import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createDispatch, listDispatches, cancelDispatch } from "../../db/dispatches.js";
import { executeDispatch, dispatchToMultiple } from "../../lib/dispatch.js";
import { formatDispatchMessage } from "../../lib/dispatch-formatter.js";
import { calculateDelay } from "../../lib/tmux.js";
import { listTasks } from "../../db/tasks.js";
import { getTaskList } from "../../db/task-lists.js";
import { getDatabase } from "../../db/database.js";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (id: string, table?: string) => string;
  formatError: (e: unknown) => string;
};

export function registerDispatchTools(server: McpServer, { shouldRegisterTool, resolveId, formatError }: Helpers): void {
  if (shouldRegisterTool("dispatch_tasks")) {
    server.tool(
      "dispatch_tasks",
      "Send specific tasks to a tmux window. Formats a message from the given task IDs and dispatches it with a configurable delay before hitting Enter. Supports dry-run preview and scheduled sending.",
      {
        task_ids: z.array(z.string()).min(1).describe("IDs of the tasks to dispatch"),
        target: z.string().describe("tmux target — window name, session:window, or session:window.pane"),
        delay_ms: z.number().optional().describe("Delay in ms between sending the message and hitting Enter. Auto-calculated from message length (3-5s) if omitted."),
        scheduled_at: z.string().optional().describe("ISO datetime to schedule the dispatch for. Fires immediately if omitted."),
        dry_run: z.boolean().optional().describe("Preview the formatted message without sending. Default: false."),
      },
      async ({ task_ids, target, delay_ms, scheduled_at, dry_run }) => {
        try {
          const db = getDatabase();
          const resolvedIds = task_ids.map((id) => resolveId(id));
          const tasks = listTasks({ ids: resolvedIds } as any, db);

          const message = formatDispatchMessage(tasks, {});
          const effectiveDelay = delay_ms ?? calculateDelay(message);

          if (dry_run) {
            return {
              content: [{ type: "text" as const, text: `[dry-run] target=${target} delay=${effectiveDelay}ms\n\n${message}` }],
            };
          }

          const dispatch = createDispatch({ task_ids: resolvedIds, target_window: target, message, delay_ms: effectiveDelay, scheduled_at }, db);
          if (!scheduled_at) await executeDispatch(dispatch, {}, db);

          return {
            content: [{
              type: "text" as const,
              text: `dispatch_id: ${dispatch.id}\nstatus: ${scheduled_at ? "scheduled" : "sent"}\ntarget: ${target}\ntasks: ${tasks.length}\ndelay: ${effectiveDelay}ms${scheduled_at ? `\nscheduled_at: ${scheduled_at}` : ""}\n\n${message}`,
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("dispatch_task_list")) {
    server.tool(
      "dispatch_task_list",
      "Send all tasks from a task list to a tmux window. Fetches matching tasks, formats them as a grouped message with a list header, and dispatches. Supports status filtering, dry-run, and scheduled sending.",
      {
        task_list_id: z.string().describe("ID or slug of the task list to dispatch"),
        target: z.string().describe("tmux target — window name, session:window, or session:window.pane"),
        filter_status: z.array(z.enum(["pending", "in_progress", "completed", "failed", "cancelled"])).optional().describe("Only include tasks with these statuses. Default: pending."),
        delay_ms: z.number().optional().describe("Delay in ms between sending and Enter. Auto-calculated if omitted."),
        scheduled_at: z.string().optional().describe("ISO datetime to schedule. Fires immediately if omitted."),
        dry_run: z.boolean().optional().describe("Preview without sending. Default: false."),
      },
      async ({ task_list_id, target, filter_status, delay_ms, scheduled_at, dry_run }) => {
        try {
          const db = getDatabase();
          const resolvedListId = resolveId(task_list_id, "task_lists");
          const taskList = getTaskList(resolvedListId, db);
          const statuses = filter_status ?? ["pending"];
          const tasks = listTasks({ task_list_id: resolvedListId, status: statuses } as any, db);

          const message = formatDispatchMessage(tasks, { listName: taskList.name });
          const effectiveDelay = delay_ms ?? calculateDelay(message);

          if (dry_run) {
            return {
              content: [{ type: "text" as const, text: `[dry-run] list=${taskList.name} target=${target} tasks=${tasks.length} delay=${effectiveDelay}ms\n\n${message}` }],
            };
          }

          const dispatch = createDispatch({ title: `Task list: ${taskList.name}`, task_list_id: resolvedListId, target_window: target, message, delay_ms: effectiveDelay, scheduled_at }, db);
          if (!scheduled_at) await executeDispatch(dispatch, {}, db);

          return {
            content: [{
              type: "text" as const,
              text: `dispatch_id: ${dispatch.id}\nstatus: ${scheduled_at ? "scheduled" : "sent"}\nlist: ${taskList.name}\ntarget: ${target}\ntasks: ${tasks.length}\ndelay: ${effectiveDelay}ms${scheduled_at ? `\nscheduled_at: ${scheduled_at}` : ""}\n\n${message}`,
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("dispatch_to_multiple")) {
    server.tool(
      "dispatch_to_multiple",
      "Fan-out: send the same tasks or task list to multiple tmux windows in sequence. A stagger delay is applied between each window.",
      {
        targets: z.array(z.string()).min(2).describe("Array of tmux targets to dispatch to"),
        task_ids: z.array(z.string()).optional().describe("Task IDs to dispatch (use this or task_list_id)"),
        task_list_id: z.string().optional().describe("Task list ID to dispatch (use this or task_ids)"),
        stagger_ms: z.number().optional().describe("Delay between each window dispatch. Default: 500ms."),
        delay_ms: z.number().optional().describe("Delay between message send and Enter. Auto-calculated if omitted."),
        dry_run: z.boolean().optional().describe("Preview without sending. Default: false."),
      },
      async ({ targets, task_ids, task_list_id, stagger_ms, delay_ms, dry_run }) => {
        try {
          if (!task_ids && !task_list_id) throw new Error("Either task_ids or task_list_id is required");
          const db = getDatabase();
          const resolvedTaskIds = task_ids ? task_ids.map((id) => resolveId(id)) : undefined;
          const resolvedListId = task_list_id ? resolveId(task_list_id, "task_lists") : undefined;

          const dispatches = await dispatchToMultiple(
            { targets, task_ids: resolvedTaskIds, task_list_id: resolvedListId, delay_ms, stagger_ms },
            { dryRun: dry_run },
            db,
          );

          const lines = dispatches.map((d) => `${d.target_window}: ${d.id} [${d.status}]`);
          return { content: [{ type: "text" as const, text: `Dispatched to ${dispatches.length} target(s):\n${lines.join("\n")}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_dispatches")) {
    server.tool(
      "list_dispatches",
      "List dispatch history with optional status filter. Shows target, task count, timing, and any errors.",
      {
        status: z.array(z.enum(["pending", "sent", "failed", "cancelled"])).optional().describe("Filter by status. Returns all if omitted."),
        limit: z.number().optional().describe("Max results to return. Default: 20."),
      },
      ({ status, limit }) => {
        try {
          const dispatches = listDispatches({ status: status as any, limit: limit ?? 20 });
          if (dispatches.length === 0) return { content: [{ type: "text" as const, text: "No dispatches found." }] };
          const lines = dispatches.map((d) => {
            const taskCount = d.task_ids.length || (d.task_list_id ? "(list)" : "0");
            const timing = d.sent_at ? `sent ${d.sent_at}` : d.scheduled_at ? `scheduled ${d.scheduled_at}` : `created ${d.created_at}`;
            const err = d.error ? ` error=${d.error.slice(0, 60)}` : "";
            return `[${d.status}] ${d.id.slice(0, 8)} → ${d.target_window} tasks=${taskCount} ${timing}${err}`;
          });
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("cancel_dispatch")) {
    server.tool(
      "cancel_dispatch",
      "Cancel a pending or scheduled dispatch. Cannot cancel dispatches that have already been sent.",
      { id: z.string().describe("Dispatch ID to cancel") },
      ({ id }) => {
        try {
          const dispatch = cancelDispatch(id);
          return { content: [{ type: "text" as const, text: `Cancelled dispatch ${dispatch.id} (target: ${dispatch.target_window})` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("run_due_dispatches")) {
    server.tool(
      "run_due_dispatches",
      "Manually trigger all pending dispatches that are due (scheduled_at <= now). Returns the count fired.",
      {
        dry_run: z.boolean().optional().describe("Preview without sending. Default: false."),
        all: z.boolean().optional().describe("Ignore scheduled_at and fire all pending dispatches immediately."),
      },
      async ({ dry_run }) => {
        try {
          const { runDueDispatches } = await import("../../lib/dispatch.js");
          const count = await runDueDispatches({ dryRun: dry_run });
          return { content: [{ type: "text" as const, text: `Fired ${count} dispatch(es).` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
