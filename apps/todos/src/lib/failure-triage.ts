/**
 * Local failure triage and retry playbooks for tasks, plans, and runs.
 */

import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { getTask, listTasks, createTask, updateTask } from "../db/tasks.js";
import { setTaskStatus } from "../db/task-status.js";
import { addComment } from "../db/comments.js";
import { listRunRecords, getRunRecord } from "./run-records.js";
import { listVerificationEvidence } from "./verification-evidence.js";
import { listAgentRuns, retryAgentRun } from "./agent-run-dispatcher.js";
import type { Task } from "../types/index.js";

export const FAILURE_TRIAGE_SCHEMA = "todos.failure_triage.v1";

export const FAILURE_CLASSES = [
  "command_failure",
  "verification_failure",
  "timeout",
  "dependency_blocked",
  "resource_error",
  "unknown",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export interface FailureTriageItem {
  entity_type: "task" | "run" | "verification" | "agent_run";
  entity_id: string;
  title: string;
  classification: FailureClass;
  reason: string;
  retry_count: number;
  max_retries: number;
  can_retry: boolean;
  playbook: string[];
}

export interface FailureTriageReport {
  schema_version: typeof FAILURE_TRIAGE_SCHEMA;
  generated_at: string;
  project_id: string | null;
  plan_id: string | null;
  items: FailureTriageItem[];
  summary: {
    total: number;
    retriable: number;
    exhausted: number;
    by_class: Record<FailureClass, number>;
  };
}

export interface ApplyFailureTriageInput {
  task_id?: string;
  run_record_id?: string;
  agent_run_id?: string;
  root_cause?: string;
  action?: "annotate" | "retry" | "reopen" | "split" | "escalate";
  agent_id?: string;
  split_title?: string;
  max_retries?: number;
}

export interface ApplyFailureTriageResult {
  schema_version: typeof FAILURE_TRIAGE_SCHEMA;
  action: string;
  classification: FailureClass;
  playbook: string[];
  task?: Task;
  retry_task?: Task;
  comment_id?: string;
  follow_up_task?: Task;
  agent_run?: ReturnType<typeof retryAgentRun>;
  escalated: boolean;
}

function classifyFailure(reason: string): FailureClass {
  const text = reason.toLowerCase();
  if (/exit code|command failed|ENOENT|command not found|non-zero/.test(text)) return "command_failure";
  if (/verification|assert|test failed|expect\(/.test(text)) return "verification_failure";
  if (/timeout|timed out|stale|deadline/.test(text)) return "timeout";
  if (/blocked|dependency|depends on/.test(text)) return "dependency_blocked";
  if (/memory|disk|sqlite|resource|EBUSY|EMFILE/.test(text)) return "resource_error";
  return "unknown";
}

function playbookFor(classification: FailureClass, canRetry: boolean): string[] {
  const base: Record<FailureClass, string[]> = {
    command_failure: [
      "Review failing command output and environment snapshot",
      "Re-run command locally with verbose logging",
      "Fix root cause or update task scope",
    ],
    verification_failure: [
      "Inspect verification evidence and test output",
      "Re-run verification provider locally",
      "Attach updated evidence before retry",
    ],
    timeout: [
      "Check for stale locks or long-running processes",
      "Increase estimate or split task into smaller steps",
      "Retry after clearing blockers",
    ],
    dependency_blocked: [
      "List blocking dependencies with todos deps blocked",
      "Complete or remove blockers",
      "Re-queue task when ready",
    ],
    resource_error: [
      "Run todos doctor and check disk/memory",
      "Compact or archive local database if needed",
      "Retry after resource cleanup",
    ],
    unknown: [
      "Document root cause in task comments",
      "Capture environment snapshot",
      "Decide retry vs split vs escalate",
    ],
  };

  const steps = [...base[classification]];
  if (canRetry) steps.push("Execute retry playbook via todos triage apply --action retry");
  else steps.push("Max retries exhausted — reopen, split, or escalate manually");
  return steps;
}

function failureReasonFromTask(task: Task): string {
  const meta = task.metadata as Record<string, unknown>;
  const failure = meta["_failure"] as { reason?: string } | undefined;
  return failure?.reason ?? "Task marked failed";
}

function createRetryTaskFromFailed(task: Task, reason: string, maxRetries: number, d: Database): Task | undefined {
  const retryCount = (task.retry_count || 0) + 1;
  if (retryCount > maxRetries) return undefined;

  const backoffMinutes = Math.pow(5, retryCount - 1);
  const retryAfter = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

  let title = task.title;
  if (task.short_id && title.startsWith(task.short_id + ": ")) {
    title = title.slice(task.short_id.length + 2);
  }

  const retryTask = createTask({
    title,
    description: task.description ?? undefined,
    priority: task.priority,
    project_id: task.project_id ?? undefined,
    task_list_id: task.task_list_id ?? undefined,
    plan_id: task.plan_id ?? undefined,
    assigned_to: task.assigned_to ?? undefined,
    tags: task.tags,
    metadata: {
      ...task.metadata,
      _retry: { original_id: task.id, retry_count: retryCount, max_retries: maxRetries, retry_after: retryAfter, failure_reason: reason },
    },
    estimated_minutes: task.estimated_minutes ?? undefined,
    due_at: retryAfter,
  }, d);

  d.run("UPDATE tasks SET retry_count = ?, max_retries = ?, retry_after = ? WHERE id = ?", [
    retryCount,
    maxRetries,
    retryAfter,
    retryTask.id,
  ]);

  return retryTask;
}

export function buildFailureTriageReport(
  filter: { project_id?: string; plan_id?: string; limit?: number } = {},
  db?: Database,
): FailureTriageReport {
  const d = getDatabase(db);
  const limit = filter.limit ?? 50;
  const items: FailureTriageItem[] = [];

  const failedTasks = listTasks(
    { project_id: filter.project_id, plan_id: filter.plan_id, status: "failed", limit },
    d,
  );
  for (const task of failedTasks) {
    const reason = failureReasonFromTask(task);
    const retryCount = task.retry_count ?? 0;
    const maxRetries = task.max_retries ?? 3;
    const canRetry = retryCount < maxRetries;
    const classification = classifyFailure(reason);
    items.push({
      entity_type: "task",
      entity_id: task.id,
      title: task.title,
      classification,
      reason,
      retry_count: retryCount,
      max_retries: maxRetries,
      can_retry: canRetry,
      playbook: playbookFor(classification, canRetry),
    });
  }

  const runs = listRunRecords({ plan_id: filter.plan_id, status: "failed", limit: 20 }, d);
  for (const run of runs) {
    const reason = run.status_transitions.at(-1)?.note ?? run.stderr_summary ?? "Run failed";
    const classification = classifyFailure(reason);
    items.push({
      entity_type: "run",
      entity_id: run.id,
      title: run.objective ?? run.id,
      classification,
      reason,
      retry_count: 0,
      max_retries: 0,
      can_retry: true,
      playbook: playbookFor(classification, true),
    });
  }

  const agentRuns = listAgentRuns({ status: "failed", limit: 20 }, d);
  for (const run of agentRuns) {
    const reason = run.error ?? "Agent run failed";
    const canRetry = run.retry_count < run.max_retries;
    const classification = classifyFailure(reason);
    items.push({
      entity_type: "agent_run",
      entity_id: run.id,
      title: run.task_id ?? run.id,
      classification,
      reason,
      retry_count: run.retry_count,
      max_retries: run.max_retries,
      can_retry: canRetry,
      playbook: playbookFor(classification, canRetry),
    });
  }

  const evidence = listVerificationEvidence({ limit: 20 }, d).filter((e) => e.status === "failed");
  for (const ev of evidence.slice(0, 10)) {
    items.push({
      entity_type: "verification",
      entity_id: ev.id,
      title: ev.summary,
      classification: "verification_failure",
      reason: ev.summary,
      retry_count: 0,
      max_retries: 0,
      can_retry: true,
      playbook: playbookFor("verification_failure", true),
    });
  }

  const byClass = Object.fromEntries(FAILURE_CLASSES.map((c) => [c, 0])) as Record<FailureClass, number>;
  for (const item of items) byClass[item.classification]++;

  return {
    schema_version: FAILURE_TRIAGE_SCHEMA,
    generated_at: now(),
    project_id: filter.project_id ?? null,
    plan_id: filter.plan_id ?? null,
    items: items.slice(0, limit),
    summary: {
      total: items.length,
      retriable: items.filter((i) => i.can_retry).length,
      exhausted: items.filter((i) => !i.can_retry).length,
      by_class: byClass,
    },
  };
}

export function applyFailureTriage(input: ApplyFailureTriageInput, db?: Database): ApplyFailureTriageResult {
  const d = getDatabase(db);
  const action = input.action ?? "annotate";

  if (input.task_id) {
    const task = getTask(input.task_id, d);
    if (!task) throw new Error(`Task not found: ${input.task_id}`);
    const reason = input.root_cause ?? failureReasonFromTask(task);
    const classification = classifyFailure(reason);
    const playbook = playbookFor(classification, (task.retry_count ?? 0) < (task.max_retries ?? 3));

    if (action === "annotate" || input.root_cause) {
      const comment = addComment(
        { task_id: task.id, content: `[triage:${classification}] ${input.root_cause ?? reason}`, agent_id: input.agent_id },
        d,
      );
      if (action === "annotate") {
        return { schema_version: FAILURE_TRIAGE_SCHEMA, action, classification, playbook, comment_id: comment.id, escalated: false };
      }
    }

    if (action === "retry") {
      const maxRetries = input.max_retries ?? task.max_retries ?? 3;
      const retryTask = createRetryTaskFromFailed(task, reason, maxRetries, d);
      return {
        schema_version: FAILURE_TRIAGE_SCHEMA,
        action,
        classification,
        playbook,
        task,
        retry_task: retryTask,
        escalated: !retryTask,
      };
    }

    if (action === "reopen") {
      const reopened = setTaskStatus(task.id, "pending", input.agent_id, d);
      return { schema_version: FAILURE_TRIAGE_SCHEMA, action, classification, playbook, task: reopened, escalated: false };
    }

    if (action === "split") {
      const followUp = createTask({
        title: input.split_title ?? `Follow-up: ${task.title}`,
        description: reason,
        project_id: task.project_id ?? undefined,
        plan_id: task.plan_id ?? undefined,
        parent_id: task.id,
        priority: task.priority,
        tags: [...(task.tags ?? []), "triage-split"],
      }, d);
      return { schema_version: FAILURE_TRIAGE_SCHEMA, action, classification, playbook, task, follow_up_task: followUp, escalated: false };
    }

    if (action === "escalate") {
      const meta = { ...task.metadata, _triage_escalated: { at: now(), reason, classification } };
      const escalated = updateTask(task.id, { priority: "critical", metadata: meta, version: task.version }, d);
      return { schema_version: FAILURE_TRIAGE_SCHEMA, action, classification, playbook, task: escalated, escalated: true };
    }
  }

  if (input.agent_run_id && action === "retry") {
    const reason = input.root_cause ?? "Manual retry";
    const classification = classifyFailure(reason);
    const agentRun = retryAgentRun(input.agent_run_id, d);
    return {
      schema_version: FAILURE_TRIAGE_SCHEMA,
      action,
      classification,
      playbook: playbookFor(classification, agentRun.retry_count < agentRun.max_retries),
      agent_run: agentRun,
      escalated: false,
    };
  }

  if (input.run_record_id) {
    const run = getRunRecord(input.run_record_id, d);
    if (!run) throw new Error(`Run record not found: ${input.run_record_id}`);
    const reason = input.root_cause ?? run.stderr_summary ?? "Run triage";
    const classification = classifyFailure(reason);
    return {
      schema_version: FAILURE_TRIAGE_SCHEMA,
      action,
      classification,
      playbook: playbookFor(classification, true),
      escalated: false,
    };
  }

  throw new Error("task_id, agent_run_id, or run_record_id required");
}

export function formatFailureTriageMarkdown(report: FailureTriageReport): string {
  const lines = [
    `# Failure triage report`,
    "",
    `Generated: ${report.generated_at}`,
    `Total: ${report.summary.total} · Retriable: ${report.summary.retriable} · Exhausted: ${report.summary.exhausted}`,
    "",
  ];

  for (const item of report.items) {
    lines.push(`## ${item.title}`, "");
    lines.push(`- Entity: ${item.entity_type} \`${item.entity_id}\``);
    lines.push(`- Class: ${item.classification}`);
    lines.push(`- Reason: ${item.reason}`);
    lines.push(`- Retries: ${item.retry_count}/${item.max_retries} · can_retry=${item.can_retry}`);
    lines.push("", "### Playbook", "");
    for (const step of item.playbook) lines.push(`1. ${step}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function getFailureTriageDocs(): string {
  return `# Failure triage

\`\`\`bash
todos triage report --project-id <id>
todos triage apply <task-id> --root-cause "tests failed" --action retry
todos triage apply <task-id> --action reopen
todos triage apply <task-id> --action split --split-title "Investigate flake"
\`\`\`
`;
}
