import type {
  ExecutorResult,
  Goal,
  GoalRun,
  Loop,
  LoopRun,
  RunReceipt,
  StoredWorkflowEvent,
  WorkflowEvent,
  WorkflowInvocation,
  WorkflowRun,
  WorkflowSpec,
  WorkflowStepRun,
  WorkflowWorkItem,
} from "../types.js";
import { publicWorkflowEvent as validatedWorkflowEvent } from "./workflow-events.js";

const TEXT_OUTPUT_LIMIT = 32 * 1024;
const SENSITIVE_PAYLOAD_KEYS = new Set(["env", "error", "prompt", "reason", "stderr", "stdout"]);

export function redact(value: string | undefined, visible = 0): string | undefined {
  if (!value) return value;
  if (value.length <= visible) return value;
  if (visible <= 0) return `[redacted ${value.length} chars]`;
  return `${value.slice(0, visible)}... [redacted ${value.length - visible} chars]`;
}

function truncateTextOutput(value: string): string {
  if (value.length <= TEXT_OUTPUT_LIMIT) return value;
  return `${value.slice(0, TEXT_OUTPUT_LIMIT)}\n[truncated ${value.length - TEXT_OUTPUT_LIMIT} chars]`;
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

export function textOutputBlocks(
  value: Pick<LoopRun | WorkflowStepRun, "stdout" | "stderr">,
  opts: { indent?: string } = {},
): string[] {
  const indent = opts.indent ?? "";
  const nested = `${indent}  `;
  const blocks: string[] = [];
  for (const [label, output] of [
    ["stdout", value.stdout],
    ["stderr", value.stderr],
  ] as const) {
    if (!output) continue;
    blocks.push(`${indent}${label}:`);
    for (const line of truncateTextOutput(output).replace(/\s+$/, "").split(/\r?\n/)) {
      blocks.push(`${nested}${line}`);
    }
  }
  return blocks;
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
    target,
  };
}

export function publicRun(run: LoopRun, showOutput = false, opts: { redactError?: boolean } = {}): Record<string, unknown> {
  return {
    ...run,
    stdout: showOutput ? run.stdout : run.stdout ? `[redacted ${run.stdout.length} chars]` : undefined,
    stderr: showOutput ? run.stderr : run.stderr ? `[redacted ${run.stderr.length} chars]` : undefined,
    error: opts.redactError ? redact(run.error) : run.error,
  };
}

export function publicRunReceipt(receipt: RunReceipt): Record<string, unknown> {
  return { ...receipt };
}

export function publicExecutorResult(result: ExecutorResult, showOutput = false): Record<string, unknown> {
  return {
    ...result,
    stdout: showOutput ? result.stdout : result.stdout ? `[redacted ${result.stdout.length} chars]` : undefined,
    stderr: showOutput ? result.stderr : result.stderr ? `[redacted ${result.stderr.length} chars]` : undefined,
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

export function publicWorkflowInvocation(invocation: WorkflowInvocation): Record<string, unknown> {
  return redactSensitivePayload(invocation) as Record<string, unknown>;
}

export function publicWorkflowWorkItem(item: WorkflowWorkItem): Record<string, unknown> {
  return { ...item, lastReason: redact(item.lastReason, 240) };
}

export function publicWorkflowStepRun(run: WorkflowStepRun, showOutput = false): Record<string, unknown> {
  return {
    ...run,
    stdout: showOutput ? run.stdout : run.stdout ? `[redacted ${run.stdout.length} chars]` : undefined,
    stderr: showOutput ? run.stderr : run.stderr ? `[redacted ${run.stderr.length} chars]` : undefined,
    error: redact(run.error),
  };
}

export function publicWorkflowEvent(event: StoredWorkflowEvent | WorkflowEvent): Record<string, unknown> {
  const validated = validatedWorkflowEvent(event);
  return { ...validated, payload: redactSensitivePayload(validated.payload) };
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
