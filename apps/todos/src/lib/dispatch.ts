import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import {
  createDispatchLog,
  getDueDispatches,
  updateDispatchStatus,
} from "../db/dispatches.js";
import { listTasks } from "../db/tasks.js";
import { now } from "../db/database.js";
import { formatDispatchMessage } from "./dispatch-formatter.js";
import { calculateDelay, sendToTmux } from "./tmux.js";
import type { CreateDispatchInput, Dispatch } from "../types/index.js";

// Re-export FormatOpts isn't defined on types yet — define it here for convenience
export type { FormatOpts } from "./dispatch-formatter.js";

/**
 * Execute a single dispatch: resolve tasks, format, send to tmux, update status.
 */
export async function executeDispatch(
  dispatch: Dispatch,
  opts: { dryRun?: boolean; formatOpts?: import("./dispatch-formatter.ts").FormatOpts } = {},
  db?: Database,
): Promise<void> {
  const _db = db ?? getDatabase();

  let message = dispatch.message;

  if (!message) {
    // Resolve tasks from task_ids or task_list_id
    const tasks =
      dispatch.task_ids.length > 0
        ? listTasks({ ids: dispatch.task_ids }, _db)
        : dispatch.task_list_id
          ? listTasks({ task_list_id: dispatch.task_list_id, status: ["pending", "in_progress"] }, _db)
          : [];

    message = formatDispatchMessage(tasks, opts.formatOpts ?? {});
  }

  const delayMs = dispatch.delay_ms ?? calculateDelay(message);

  try {
    await sendToTmux(dispatch.target_window, message, delayMs, opts.dryRun ?? false);

    createDispatchLog(
      {
        dispatch_id: dispatch.id,
        target_window: dispatch.target_window,
        message,
        delay_ms: delayMs,
        status: "sent",
        error: null,
      },
      _db,
    );

    if (!opts.dryRun) {
      updateDispatchStatus(dispatch.id, "sent", { sent_at: now() }, _db);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    createDispatchLog(
      {
        dispatch_id: dispatch.id,
        target_window: dispatch.target_window,
        message,
        delay_ms: delayMs,
        status: "failed",
        error,
      },
      _db,
    );

    updateDispatchStatus(dispatch.id, "failed", { error }, _db);
    throw err;
  }
}

/**
 * Run all due dispatches (pending + scheduled_at <= now).
 * Returns the count of dispatches that were fired.
 */
export async function runDueDispatches(
  opts: { dryRun?: boolean } = {},
  db?: Database,
): Promise<number> {
  const _db = db ?? getDatabase();
  const due = getDueDispatches(_db);

  let count = 0;
  for (const dispatch of due) {
    try {
      await executeDispatch(dispatch, opts, _db);
      count++;
    } catch {
      // Error already logged and status updated — continue to next
    }
  }

  return count;
}

/**
 * Fan-out: dispatch the same task set to multiple tmux windows.
 * Returns the list of created Dispatch objects.
 */
export async function dispatchToMultiple(
  input: Omit<CreateDispatchInput, "target_window"> & { targets: string[]; stagger_ms?: number },
  opts: { dryRun?: boolean } = {},
  db?: Database,
): Promise<Dispatch[]> {
  const _db = db ?? getDatabase();
  const { createDispatch } = await import("../db/dispatches.js");
  const { targets, stagger_ms = 500, ...baseInput } = input;

  const dispatches: Dispatch[] = [];

  for (const target of targets) {
    const dispatch = createDispatch({ ...baseInput, target_window: target }, _db);
    dispatches.push(dispatch);

    await executeDispatch(dispatch, opts, _db);

    if (stagger_ms > 0 && targets.indexOf(target) < targets.length - 1) {
      await Bun.sleep(stagger_ms);
    }
  }

  return dispatches;
}
