import type {
  ExecutorResult,
  Goal,
  GoalRun,
  Loop,
  LoopRun,
  RunReceipt,
  PublicWorkflowEvent,
  StoredWorkflowEvent,
  WorkflowInvocation,
  WorkflowRun,
  WorkflowSpec,
  WorkflowStepRun,
  WorkflowWorkItem,
} from "../types.js";
import { isRedactionPlaceholder, scrubSecrets } from "./redact.js";
import { publicWorkflowEvent as validatedWorkflowEvent } from "./workflow-events.js";

const TEXT_OUTPUT_LIMIT = 32 * 1024;
const SENSITIVE_PAYLOAD_KEYS = new Set(["env", "error", "prompt", "reason", "stderr", "stdout"]);

/**
 * Replace `value` with a placeholder recording how long it was.
 *
 * Idempotent: redacting an already-redacted value returns it unchanged rather
 * than reporting the placeholder's own length. A control-plane client reads
 * loops through an API that has already redacted them, then formats them for
 * display — without this, a 137-character prompt printed as "[redacted 20
 * chars]" (the length of "[redacted 137 chars]"), which silently destroyed the
 * only signal an operator had for checking the stored prompt was intact.
 */
export function redact(value: string | undefined, visible = 0): string | undefined {
  if (!value) return value;
  if (isRedactionPlaceholder(value)) return value;
  const scrubbed = scrubSecrets(value);
  if (scrubbed.length <= visible) return scrubbed;
  if (visible <= 0) return `[redacted ${scrubbed.length} chars]`;
  return `${scrubbed.slice(0, visible)}... [redacted ${scrubbed.length - visible} chars]`;
}

function truncateTextOutput(value: string): string {
  const scrubbed = scrubSecrets(value);
  if (scrubbed.length <= TEXT_OUTPUT_LIMIT) return scrubbed;
  return `${scrubbed.slice(0, TEXT_OUTPUT_LIMIT)}\n[truncated ${scrubbed.length - TEXT_OUTPUT_LIMIT} chars]`;
}

function scrubOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : scrubSecrets(value);
}

function redactSensitivePayload(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    const scrubbed = scrubSecrets(value);
    return key && SENSITIVE_PAYLOAD_KEYS.has(key) ? redact(scrubbed) : scrubbed;
  }
  if (key && SENSITIVE_PAYLOAD_KEYS.has(key)) {
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
    stdout: showOutput ? scrubOptional(run.stdout) : run.stdout ? `[redacted ${run.stdout.length} chars]` : undefined,
    stderr: showOutput ? scrubOptional(run.stderr) : run.stderr ? `[redacted ${run.stderr.length} chars]` : undefined,
    error: opts.redactError ? redact(run.error) : scrubOptional(run.error),
  };
}

export function publicRunReceipt(receipt: RunReceipt): Record<string, unknown> {
  return { ...receipt };
}

export function publicExecutorResult(result: ExecutorResult, showOutput = false): Record<string, unknown> {
  return {
    ...result,
    stdout: showOutput ? scrubOptional(result.stdout) : result.stdout ? `[redacted ${result.stdout.length} chars]` : undefined,
    stderr: showOutput ? scrubOptional(result.stderr) : result.stderr ? `[redacted ${result.stderr.length} chars]` : undefined,
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
    stdout: showOutput ? scrubOptional(run.stdout) : run.stdout ? `[redacted ${run.stdout.length} chars]` : undefined,
    stderr: showOutput ? scrubOptional(run.stderr) : run.stderr ? `[redacted ${run.stderr.length} chars]` : undefined,
    error: redact(run.error),
  };
}

export function publicWorkflowEvent(event: StoredWorkflowEvent | PublicWorkflowEvent): Record<string, unknown> {
  const validated = validatedWorkflowEvent(event);
  if ("eventKind" in validated && validated.eventKind === "custom") return { ...validated };
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
