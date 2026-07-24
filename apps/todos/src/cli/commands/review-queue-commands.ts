import type { Command } from "commander";
import chalk from "chalk";
import { handleError, output, resolveTaskId, parseOptionalPositiveSafeInteger } from "../helpers.js";
import type { ReviewQueueState } from "../../lib/review-queues.js";
import type { TaskPriority } from "../../types/index.js";

function splitList(value?: string): string[] | undefined {
  return value?.split(";").flatMap((part) => part.split(",")).map((item) => item.trim()).filter(Boolean);
}

function parseLimit(value?: string): number | undefined {
  return parseOptionalPositiveSafeInteger(value, "--limit");
}

export function registerReviewQueueCommands(program: Command) {
  const reviews = program
    .command("reviews")
    .alias("review-queue")
    .description("Manage local review queues, reviewer claims, returns, approvals, and routing rules");

  reviews
    .command("list")
    .description("List local tasks waiting in review queues")
    .option("--queue <name>", "Filter by review queue")
    .option("--state <state>", "Filter by review state")
    .option("--reviewer <name>", "Filter by assigned or claiming reviewer")
    .option("--requester <name>", "Filter by requester")
    .option("--project <id>", "Filter by project ID")
    .option("--limit <n>", "Maximum queue items")
    .action(async (opts: { queue?: string; state?: ReviewQueueState; reviewer?: string; requester?: string; project?: string; limit?: string }) => {
      const globalOpts = program.opts();
      try {
        const { listReviewQueue } = await import("../../lib/review-queues.js");
        const items = listReviewQueue({
          queue: opts.queue,
          state: opts.state,
          reviewer: opts.reviewer,
          requester: opts.requester,
          project_id: opts.project,
          limit: parseLimit(opts.limit),
        });
        if (globalOpts.json) { output(items, true); return; }
        if (items.length === 0) {
          console.log(chalk.dim("Review queue is empty."));
          return;
        }
        for (const item of items) {
          const assignee = item.claimed_by || item.reviewer || "(unclaimed)";
          console.log(`${chalk.dim(item.task_id.slice(0, 8))} ${item.state.padEnd(17)} ${item.queue.padEnd(12)} ${assignee.padEnd(12)} ${item.title}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  reviews
    .command("request <task-id>")
    .description("Request local review for a task")
    .option("--requester <name>", "Requester agent or human")
    .option("--reviewer <name>", "Preferred reviewer")
    .option("--queue <name>", "Review queue name")
    .option("--reason <text>", "Reason for review")
    .option("--notes <text>", "Reviewer notes")
    .action(async (taskId: string, opts: { requester?: string; reviewer?: string; queue?: string; reason?: string; notes?: string }) => {
      const globalOpts = program.opts();
      try {
        const { requestReviewQueue } = await import("../../lib/review-queues.js");
        const item = requestReviewQueue({
          task_id: resolveTaskId(taskId),
          requester: opts.requester || globalOpts.agent || "cli",
          reviewer: opts.reviewer,
          queue: opts.queue,
          reason: opts.reason,
          notes: opts.notes,
        });
        if (globalOpts.json) { output(item, true); return; }
        console.log(chalk.green(`Review requested: ${item.task_id.slice(0, 8)} -> ${item.queue}`));
      } catch (e) {
        handleError(e);
      }
    });

  reviews
    .command("claim <task-id>")
    .description("Claim a task from the local review queue")
    .requiredOption("--reviewer <name>", "Reviewer claiming the task")
    .option("--note <text>", "Claim note")
    .action(async (taskId: string, opts: { reviewer: string; note?: string }) => {
      const globalOpts = program.opts();
      try {
        const { claimReviewItem } = await import("../../lib/review-queues.js");
        const item = claimReviewItem({ task_id: resolveTaskId(taskId), reviewer: opts.reviewer, note: opts.note });
        if (globalOpts.json) { output(item, true); return; }
        console.log(chalk.green(`Review claimed: ${item.task_id.slice(0, 8)} by ${item.claimed_by}`));
      } catch (e) {
        handleError(e);
      }
    });

  reviews
    .command("approve <task-id>")
    .description("Approve a reviewed task")
    .requiredOption("--reviewer <name>", "Reviewer approving the task")
    .option("--note <text>", "Approval note")
    .action(async (taskId: string, opts: { reviewer: string; note?: string }) => {
      const globalOpts = program.opts();
      try {
        const { approveReviewItem } = await import("../../lib/review-queues.js");
        const item = approveReviewItem({ task_id: resolveTaskId(taskId), reviewer: opts.reviewer, note: opts.note });
        if (globalOpts.json) { output(item, true); return; }
        console.log(chalk.green(`Review approved: ${item.task_id.slice(0, 8)} by ${item.reviewer}`));
      } catch (e) {
        handleError(e);
      }
    });

  reviews
    .command("return <task-id>")
    .description("Return a reviewed task with requested changes")
    .requiredOption("--reviewer <name>", "Reviewer returning the task")
    .option("--changes <list>", "Semicolon- or comma-separated requested changes")
    .option("--note <text>", "Return note")
    .action(async (taskId: string, opts: { reviewer: string; changes?: string; note?: string }) => {
      const globalOpts = program.opts();
      try {
        const { returnReviewItem } = await import("../../lib/review-queues.js");
        const item = returnReviewItem({
          task_id: resolveTaskId(taskId),
          reviewer: opts.reviewer,
          note: opts.note,
          changes_requested: splitList(opts.changes),
        });
        if (globalOpts.json) { output(item, true); return; }
        console.log(chalk.yellow(`Review returned: ${item.task_id.slice(0, 8)} with ${item.changes_requested.length} requested change(s)`));
      } catch (e) {
        handleError(e);
      }
    });

  reviews
    .command("reopen <task-id>")
    .description("Reopen a reviewed task for another review pass")
    .requiredOption("--reviewer <name>", "Reviewer reopening the review")
    .option("--note <text>", "Reopen note")
    .action(async (taskId: string, opts: { reviewer: string; note?: string }) => {
      const globalOpts = program.opts();
      try {
        const { reopenReviewItem } = await import("../../lib/review-queues.js");
        const item = reopenReviewItem({ task_id: resolveTaskId(taskId), reviewer: opts.reviewer, note: opts.note });
        if (globalOpts.json) { output(item, true); return; }
        console.log(chalk.yellow(`Review reopened: ${item.task_id.slice(0, 8)}`));
      } catch (e) {
        handleError(e);
      }
    });

  const rules = reviews
    .command("rules")
    .description("Manage local review routing rules");

  rules
    .command("list")
    .description("List local review routing rules")
    .action(async () => {
      const globalOpts = program.opts();
      try {
        const { listReviewRoutingRules } = await import("../../lib/review-queues.js");
        const items = listReviewRoutingRules();
        if (globalOpts.json) { output(items, true); return; }
        if (items.length === 0) {
          console.log(chalk.dim("No review routing rules configured."));
          return;
        }
        for (const rule of items) {
          console.log(`${rule.enabled ? chalk.green("on ") : chalk.gray("off")} ${rule.name.padEnd(16)} ${rule.queue.padEnd(12)} ${rule.reviewers.join(",") || "(no reviewers)"}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  rules
    .command("set <name>")
    .description("Create or update a local review routing rule")
    .option("--queue <name>", "Queue name")
    .option("--reviewers <list>", "Comma-separated reviewer names")
    .option("--tags <list>", "Comma-separated task tags matched by this rule")
    .option("--priorities <list>", "Comma-separated priorities matched by this rule")
    .option("--project <id>", "Project ID matched by this rule")
    .option("--disable", "Disable this rule")
    .action(async (name: string, opts: { queue?: string; reviewers?: string; tags?: string; priorities?: string; project?: string; disable?: boolean }) => {
      const globalOpts = program.opts();
      try {
        const { upsertReviewRoutingRule } = await import("../../lib/review-queues.js");
        const rule = upsertReviewRoutingRule({
          name,
          queue: opts.queue,
          reviewers: splitList(opts.reviewers),
          tags: splitList(opts.tags),
          priorities: splitList(opts.priorities) as TaskPriority[] | undefined,
          project_id: opts.project,
          enabled: opts.disable ? false : undefined,
        });
        if (globalOpts.json) { output(rule, true); return; }
        console.log(chalk.green(`Review routing rule saved: ${rule.name}`));
      } catch (e) {
        handleError(e);
      }
    });

  rules
    .command("remove <name>")
    .description("Remove a local review routing rule")
    .action(async (name: string) => {
      const globalOpts = program.opts();
      try {
        const { removeReviewRoutingRule } = await import("../../lib/review-queues.js");
        const removed = removeReviewRoutingRule(name);
        if (globalOpts.json) { output({ removed }, true); return; }
        console.log(removed ? chalk.green("Review routing rule removed.") : chalk.dim("No review routing rule matched."));
      } catch (e) {
        handleError(e);
      }
    });
}
