import { scrubSecrets } from "./redact.js";
import type { ExecutorResult, WorkflowRun, WorkflowStepRun, WorkflowStepRunStatus } from "../types.js";

/** Maximum characters kept from each end of a child output when building parent envelopes. */
export const ENVELOPE_EXCERPT_CHARS = 2048;

/** Stable marker prefix recorded on skipped step runs that were blocked by policy exit codes. */
export const BLOCKED_STEP_ERROR_PREFIX = "blocked:";

/**
 * Excerpts scrub BEFORE truncating: cutting raw output at fixed character
 * boundaries can bisect a credential (e.g. an `sk-ant-…` key whose prefix
 * falls in the omitted middle), leaving a fragment no scrub pattern matches.
 * scrubSecrets is idempotent, so store-time re-scrubbing stays safe.
 */
export function boundedExcerpt(text: string | undefined, limit = ENVELOPE_EXCERPT_CHARS): string | undefined {
  if (!text) return undefined;
  const scrubbed = scrubSecrets(text);
  if (scrubbed.length <= limit * 2) return scrubbed;
  const omitted = scrubbed.length - limit * 2;
  return `${scrubbed.slice(0, limit)}\n[... ${omitted} chars omitted ...]\n${scrubbed.slice(-limit)}`;
}

export interface OutputSummary {
  stdoutBytes: number;
  stderrBytes: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
}

export function summarizeOutput(stdout: string | undefined, stderr: string | undefined): OutputSummary {
  return {
    stdoutBytes: stdout ? Buffer.byteLength(stdout, "utf8") : 0,
    stderrBytes: stderr ? Buffer.byteLength(stderr, "utf8") : 0,
    stdoutExcerpt: boundedExcerpt(stdout),
    stderrExcerpt: boundedExcerpt(stderr),
  };
}

export interface ExecutorResultSummary extends OutputSummary {
  status: ExecutorResult["status"];
  exitCode?: number;
  durationMs: number;
  error?: string;
}

export function summarizeExecutorResult(
  result: Pick<ExecutorResult, "status" | "exitCode" | "durationMs" | "stdout" | "stderr" | "error">,
): ExecutorResultSummary {
  return {
    ...summarizeOutput(result.stdout, result.stderr),
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    error: boundedExcerpt(result.error),
  };
}

export interface WorkflowStepRunSummary extends OutputSummary {
  stepId: string;
  status: WorkflowStepRunStatus;
  exitCode?: number;
  durationMs?: number;
  error?: string;
  blocked: boolean;
}

export function isBlockedStepRun(step: Pick<WorkflowStepRun, "status" | "error"> | undefined): boolean {
  return step?.status === "skipped" && (step.error?.startsWith(BLOCKED_STEP_ERROR_PREFIX) ?? false);
}

export function summarizeWorkflowStepRun(step: WorkflowStepRun): WorkflowStepRunSummary {
  return {
    ...summarizeOutput(step.stdout, step.stderr),
    stepId: step.stepId,
    status: step.status,
    exitCode: step.exitCode,
    durationMs: step.durationMs,
    error: boundedExcerpt(step.error),
    blocked: isBlockedStepRun(step),
  };
}

/**
 * Parent-run result envelope: per-step summaries only. Full child output stays on the
 * workflow step run rows; duplicating it here bloated the database and propagated secrets.
 */
export function workflowRunEnvelope(run: WorkflowRun, steps: WorkflowStepRun[]): string {
  return JSON.stringify({ workflowRun: run, steps: steps.map(summarizeWorkflowStepRun) }, null, 2);
}
