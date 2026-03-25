import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import { listTasks } from "../../db/tasks.js";
import { getTaskList } from "../../db/task-lists.js";
import { createDispatch, listDispatches, cancelDispatch } from "../../db/dispatches.js";
import { executeDispatch, runDueDispatches, dispatchToMultiple } from "../../lib/dispatch.js";
import { formatDispatchMessage } from "../../lib/dispatch-formatter.js";
import { calculateDelay } from "../../lib/tmux.js";
import type { Task } from "../../types/index.js";

export function registerDispatchCommands(program: Command): void {
  // ── dispatch subcommand ──────────────────────────────────────────────────────
  const dispatchCmd = program
    .command("dispatch")
    .description("Send tasks or task lists to a tmux window")
    .argument("<target>", "tmux target: window, session:window, or session:window.pane")
    .option("--tasks <ids>", "Comma-separated task IDs to dispatch")
    .option("--list <id>", "Task list ID or slug to dispatch")
    .option("--filter-status <statuses>", "Comma-separated task statuses to include (default: pending)", "pending")
    .option("--delay <ms>", "Delay in ms between message and Enter (auto-calculated if omitted)", parseInt)
    .option("--at <datetime>", "ISO datetime to schedule the dispatch")
    .option("--multiple <targets>", "Comma-separated list of additional tmux targets (fan-out)")
    .option("--stagger <ms>", "Delay between targets when using --multiple (default: 500ms)", parseInt)
    .option("--dry-run", "Preview the formatted message without sending")
    .action(async (target: string, opts) => {
      const globalOpts = program.opts();
      const useJson = globalOpts.json;
      const db = getDatabase();

      try {
        let tasks: Task[] = [];
        let listName: string | undefined;

        if (opts.tasks) {
          const ids = (opts.tasks as string).split(",").map((s: string) => s.trim());
          const resolvedIds = ids.map((id: string) => {
            const resolved = resolvePartialId(db, "tasks", id);
            if (!resolved) throw new Error(`Task not found: ${id}`);
            return resolved;
          });
          tasks = listTasks({ ids: resolvedIds } as any, db);
        } else if (opts.list) {
          const resolvedListId = resolvePartialId(db, "task_lists", opts.list);
          if (!resolvedListId) throw new Error(`Task list not found: ${opts.list}`);
          const taskList = getTaskList(resolvedListId, db);
          listName = taskList.name;
          const statuses = (opts.filterStatus as string).split(",").map((s: string) => s.trim());
          tasks = listTasks({ task_list_id: resolvedListId, status: statuses } as any, db);
        } else {
          console.error(chalk.red("Error: provide --tasks <ids> or --list <id>"));
          process.exit(1);
        }

        const message = formatDispatchMessage(tasks, { listName });
        const delayMs = opts.delay ?? calculateDelay(message);

        if (opts.dryRun) {
          console.log(chalk.dim(`[dry-run] target=${target} delay=${delayMs}ms tasks=${tasks.length}`));
          console.log(message);
          return;
        }

        const targets = opts.multiple
          ? [target, ...(opts.multiple as string).split(",").map((s: string) => s.trim())]
          : [target];

        if (targets.length > 1) {
          const dispatches = await dispatchToMultiple(
            { targets, task_ids: tasks.map((t) => t.id), message, delay_ms: delayMs, stagger_ms: opts.stagger ?? 500, scheduled_at: opts.at },
            {},
            db,
          );
          if (useJson) {
            console.log(JSON.stringify(dispatches, null, 2));
          } else {
            for (const d of dispatches) {
              console.log(chalk.green(`✓`) + ` ${d.target_window} [${d.id.slice(0, 8)}]`);
            }
          }
        } else {
          const dispatch = createDispatch(
            { target_window: target, task_ids: tasks.map((t) => t.id), message, delay_ms: delayMs, scheduled_at: opts.at },
            db,
          );

          if (!opts.at) {
            await executeDispatch(dispatch, {}, db);
            if (useJson) {
              console.log(JSON.stringify({ id: dispatch.id, status: "sent" }));
            } else {
              console.log(chalk.green(`✓`) + ` Dispatched to ${target} (${tasks.length} task${tasks.length !== 1 ? "s" : ""})`);
            }
          } else {
            if (useJson) {
              console.log(JSON.stringify({ id: dispatch.id, status: "scheduled", scheduled_at: opts.at }));
            } else {
              console.log(chalk.yellow(`Scheduled`) + ` dispatch ${dispatch.id.slice(0, 8)} → ${target} at ${opts.at}`);
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (useJson) {
          console.log(JSON.stringify({ error: msg }));
        } else {
          console.error(chalk.red(`Error: ${msg}`));
        }
        process.exit(1);
      }
    });

  // todos dispatch run
  dispatchCmd
    .command("run")
    .description("Fire all pending dispatches that are due now")
    .option("--all", "Ignore scheduled_at and fire all pending immediately")
    .option("--dry-run", "Preview without sending")
    .action(async (opts) => {
      try {
        const count = await runDueDispatches({ dryRun: opts.dryRun });
        console.log(chalk.green(`Fired ${count} dispatch(es).`));
      } catch (e) {
        console.error(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
      }
    });

  // ── dispatches list ──────────────────────────────────────────────────────────
  program
    .command("dispatches")
    .description("List dispatch history")
    .option("--status <status>", "Filter by status: pending, sent, failed, cancelled")
    .option("--limit <n>", "Max results (default: 20)", parseInt)
    .option("--cancel <id>", "Cancel a pending dispatch by ID")
    .action((opts) => {
      const globalOpts = program.opts();
      const useJson = globalOpts.json;

      if (opts.cancel) {
        try {
          const dispatch = cancelDispatch(opts.cancel);
          if (useJson) {
            console.log(JSON.stringify(dispatch, null, 2));
          } else {
            console.log(chalk.yellow(`Cancelled`) + ` dispatch ${dispatch.id.slice(0, 8)} → ${dispatch.target_window}`);
          }
          return;
        } catch (e) {
          console.error(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`));
          process.exit(1);
        }
      }

      const statuses = opts.status ? opts.status.split(",").map((s: string) => s.trim()) : undefined;
      const dispatches = listDispatches({ status: statuses as any, limit: opts.limit ?? 20 });

      if (useJson) {
        console.log(JSON.stringify(dispatches, null, 2));
        return;
      }

      if (dispatches.length === 0) {
        console.log(chalk.dim("No dispatches found."));
        return;
      }

      const STATUS_COLOR: Record<string, (s: string) => string> = {
        pending: chalk.yellow,
        sent: chalk.green,
        failed: chalk.red,
        cancelled: chalk.dim,
      };

      for (const d of dispatches) {
        const colorFn = STATUS_COLOR[d.status] ?? chalk.white;
        const taskCount = d.task_ids.length || (d.task_list_id ? "(list)" : "0");
        const timing = d.sent_at
          ? `sent ${d.sent_at}`
          : d.scheduled_at
            ? `scheduled ${d.scheduled_at}`
            : `created ${d.created_at}`;
        const err = d.error ? chalk.red(` err=${d.error.slice(0, 50)}`) : "";
        console.log(
          `${colorFn(d.status.padEnd(9))} ${d.id.slice(0, 8)} → ${chalk.bold(d.target_window)} tasks=${taskCount} ${chalk.dim(timing)}${err}`,
        );
      }
    });
}
