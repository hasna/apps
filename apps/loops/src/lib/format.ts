import type {
  ExecutorResult,
  Goal,
  GoalPlanNode,
  GoalRun,
  Loop,
  LoopRun,
  LoopTarget,
  ScheduleSpec,
  WorkflowEvent,
  WorkflowRun,
  WorkflowSpec,
  WorkflowStepRun,
} from "../types.js";
import type { DaemonStatus } from "../daemon/control.js";

const SENSITIVE_PAYLOAD_KEYS = new Set(["env", "error", "prompt", "reason", "stderr", "stdout"]);

export function redact(value: string | undefined, visible = 0): string | undefined {
  if (!value) return value;
  if (value.length <= visible) return value;
  if (visible <= 0) return `[redacted ${value.length} chars]`;
  return `${value.slice(0, visible)}... [redacted ${value.length - visible} chars]`;
}

export function truncateDisplay(value: string | undefined, maxChars = 120): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 20) return `${normalized.slice(0, maxChars)}...`;
  return `${normalized.slice(0, maxChars - 14)}... (${normalized.length - (maxChars - 14)} more)`;
}

function truncateTextOutput(value: string, limit?: number): string {
  if (limit === undefined) return value;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated ${value.length - limit} chars]`;
}

function redactSensitivePayload(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_PAYLOAD_KEYS.has(key)) {
    if (typeof value === "string") return redact(value);
    if (value === undefined || value === null) return value;
    return "[redacted]";
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitivePayload(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSensitivePayload(entryValue, entryKey)]));
  }
  return value;
}

export function textOutputBlocks(value: Pick<LoopRun | WorkflowStepRun, "stdout" | "stderr">, opts: { indent?: string; limit?: number } = {}): string[] {
  const indent = opts.indent ?? "";
  const nested = `${indent}  `;
  const blocks: string[] = [];
  for (const [label, output] of [
    ["stdout", value.stdout],
    ["stderr", value.stderr],
  ] as const) {
    if (!output) continue;
    blocks.push(`${indent}${label}:`);
    for (const line of truncateTextOutput(output, opts.limit).replace(/\s+$/, "").split(/\r?\n/)) {
      blocks.push(`${nested}${line}`);
    }
  }
  return blocks;
}

export function scheduleSummary(schedule: ScheduleSpec): string {
  if (schedule.type === "once") return `once ${schedule.at}`;
  if (schedule.type === "interval") return `every ${schedule.everyMs}ms ${schedule.anchor ?? "fixed_rate"}`;
  if (schedule.type === "cron") return `cron ${schedule.expression}`;
  return `dynamic min=${schedule.minIntervalMs ?? 60_000}ms`;
}

export function targetSummary(target: LoopTarget): string {
  if (target.type === "command") {
    const command = target.args?.length ? `${target.command} ${target.args.join(" ")}` : target.command;
    return `command ${truncateDisplay(command, 80)}`;
  }
  if (target.type === "agent") {
    const model = target.model ? ` model=${target.model}` : "";
    const agent = target.agent ? ` agent=${target.agent}` : "";
    return `agent ${target.provider}${model}${agent}`;
  }
  return `workflow ${target.workflowId}`;
}

export function compactLoop(loop: Loop): Record<string, unknown> {
  return {
    id: loop.id,
    name: loop.name,
    status: loop.status,
    nextRunAt: loop.nextRunAt,
    retryScheduledFor: loop.retryScheduledFor,
    schedule: scheduleSummary(loop.schedule),
    target: targetSummary(loop.target),
    labels: loop.labels ?? [],
    machine: loop.machine?.id,
    goal: Boolean(loop.goal),
    updatedAt: loop.updatedAt,
  };
}

export function compactRun(run: LoopRun): Record<string, unknown> {
  return {
    id: run.id,
    loopId: run.loopId,
    loopName: run.loopName,
    status: run.status,
    attempt: run.attempt,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    hasOutput: Boolean(run.stdout || run.stderr),
    updatedAt: run.updatedAt,
  };
}

export function compactWorkflow(workflow: WorkflowSpec): Record<string, unknown> {
  return {
    id: workflow.id,
    name: workflow.name,
    status: workflow.status,
    version: workflow.version,
    steps: workflow.steps.length,
    goal: Boolean(workflow.goal),
    updatedAt: workflow.updatedAt,
  };
}

export function compactWorkflowRun(run: WorkflowRun): Record<string, unknown> {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    status: run.status,
    loopRunId: run.loopRunId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    error: redact(run.error),
    updatedAt: run.updatedAt,
  };
}

export function compactWorkflowStepRun(run: WorkflowStepRun): Record<string, unknown> {
  return {
    id: run.id,
    stepId: run.stepId,
    sequence: run.sequence,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    hasOutput: Boolean(run.stdout || run.stderr),
    error: redact(run.error),
  };
}

export function compactWorkflowEvent(event: WorkflowEvent): Record<string, unknown> {
  return {
    id: event.id,
    sequence: event.sequence,
    eventType: event.eventType,
    stepId: event.stepId,
    createdAt: event.createdAt,
  };
}

export function compactGoal(goal: Goal): Record<string, unknown> {
  return {
    goalId: goal.goalId,
    status: goal.status,
    objective: redact(goal.objective, 120),
    tokensUsed: goal.tokensUsed,
    tokenBudget: goal.tokenBudget,
    timeUsedSeconds: goal.timeUsedSeconds,
    sourceType: goal.sourceType,
    sourceId: goal.sourceId,
    updatedAt: goal.updatedAt,
  };
}

export function compactGoalPlanNode(node: GoalPlanNode): Record<string, unknown> {
  return {
    nodeId: node.nodeId,
    planId: node.planId,
    key: node.key,
    sequence: node.sequence,
    priority: node.priority,
    objective: truncateDisplay(node.objective, 160),
    status: node.status,
    ready: node.ready,
    tokenBudget: node.tokenBudget,
    tokensUsed: node.tokensUsed,
    timeUsedSeconds: node.timeUsedSeconds,
    dependsOn: node.dependsOn,
    updatedAt: node.updatedAt,
  };
}

export function compactGoalRun(run: GoalRun): Record<string, unknown> {
  return {
    runId: run.runId,
    goalId: run.goalId,
    turn: run.turn,
    phase: run.phase,
    status: run.status,
    nodeKey: run.nodeKey,
    tokensUsed: run.tokensUsed,
    createdAt: run.createdAt,
  };
}

export function daemonStatusSummary(status: DaemonStatus): string {
  const daemon = status.running ? `running pid=${status.pid}` : status.stale ? `stale pid=${status.pid}` : "stopped";
  const lease = status.lease ? ` lease=pid:${status.lease.pid}@${status.lease.hostname} until=${status.lease.expiresAt}` : "";
  return [
    `daemon ${daemon} host=${status.host}${lease}`,
    `loops total=${status.loops.total} active=${status.loops.active} paused=${status.loops.paused} stopped=${status.loops.stopped} expired=${status.loops.expired}`,
    `runs total=${status.runs.total} running=${status.runs.running} failed=${status.runs.failed} succeeded=${status.runs.succeeded} abandoned=${status.runs.abandoned}`,
    `logs=${status.logPath}`,
    "Use --verbose or --json for full daemon status.",
  ].join("\n");
}

export function publicLoop(loop: Loop): Record<string, unknown> {
  const target =
    loop.target.type === "command"
      ? { ...loop.target, env: loop.target.env ? "[redacted]" : undefined }
      : loop.target.type === "agent"
        ? { ...loop.target, prompt: redact(loop.target.prompt) }
        : loop.target;
  return {
    ...loop,
    labels: loop.labels ?? [],
    target,
  };
}

export function publicRun(run: LoopRun, showOutput = false, maxOutputChars?: number): Record<string, unknown> {
  return {
    ...run,
    stdout: showOutput ? (run.stdout ? truncateTextOutput(run.stdout, maxOutputChars) : run.stdout) : run.stdout ? `[redacted ${run.stdout.length} chars]` : undefined,
    stderr: showOutput ? (run.stderr ? truncateTextOutput(run.stderr, maxOutputChars) : run.stderr) : run.stderr ? `[redacted ${run.stderr.length} chars]` : undefined,
  };
}

export function publicExecutorResult(result: ExecutorResult, showOutput = false, maxOutputChars?: number): Record<string, unknown> {
  return {
    ...result,
    stdout: showOutput ? (result.stdout ? truncateTextOutput(result.stdout, maxOutputChars) : result.stdout) : result.stdout ? `[redacted ${result.stdout.length} chars]` : undefined,
    stderr: showOutput ? (result.stderr ? truncateTextOutput(result.stderr, maxOutputChars) : result.stderr) : result.stderr ? `[redacted ${result.stderr.length} chars]` : undefined,
    error: redact(result.error),
  };
}

export function publicWorkflow(workflow: WorkflowSpec): Record<string, unknown> {
  return {
    ...workflow,
    steps: workflow.steps.map((step) => ({
      ...step,
      target:
        step.target.type === "agent"
          ? { ...step.target, prompt: redact(step.target.prompt) }
          : step.target.type === "command" && step.target.env
            ? { ...step.target, env: "[redacted]" }
            : step.target,
    })),
  };
}

export function publicWorkflowRun(run: WorkflowRun): Record<string, unknown> {
  return { ...run, error: redact(run.error) };
}

export function publicWorkflowStepRun(run: WorkflowStepRun, showOutput = false, maxOutputChars?: number): Record<string, unknown> {
  return {
    ...run,
    stdout: showOutput ? (run.stdout ? truncateTextOutput(run.stdout, maxOutputChars) : run.stdout) : run.stdout ? `[redacted ${run.stdout.length} chars]` : undefined,
    stderr: showOutput ? (run.stderr ? truncateTextOutput(run.stderr, maxOutputChars) : run.stderr) : run.stderr ? `[redacted ${run.stderr.length} chars]` : undefined,
    error: redact(run.error),
  };
}

export function publicWorkflowEvent(event: WorkflowEvent): Record<string, unknown> {
  return { ...event, payload: redactSensitivePayload(event.payload) };
}

export function publicGoal(goal: Goal): Record<string, unknown> {
  return {
    ...goal,
    objective: redact(goal.objective, 120),
  };
}

export function publicGoalRun(run: GoalRun): Record<string, unknown> {
  return {
    ...run,
    evidence: redactSensitivePayload(run.evidence),
    rawResponse: redactSensitivePayload(run.rawResponse),
  };
}
