import type { Loop, LoopRun, WorkflowEvent, WorkflowRun, WorkflowSpec, WorkflowStepRun } from "../types.js";

const TEXT_OUTPUT_LIMIT = 32 * 1024;

export function redact(value: string | undefined, visible = 80): string | undefined {
  if (!value) return value;
  if (value.length <= visible) return value;
  return `${value.slice(0, visible)}... [redacted ${value.length - visible} chars]`;
}

function truncateTextOutput(value: string): string {
  if (value.length <= TEXT_OUTPUT_LIMIT) return value;
  return `${value.slice(0, TEXT_OUTPUT_LIMIT)}\n[truncated ${value.length - TEXT_OUTPUT_LIMIT} chars]`;
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

export function publicRun(run: LoopRun, showOutput = false): Record<string, unknown> {
  return {
    ...run,
    stdout: showOutput ? run.stdout : run.stdout ? `[redacted ${run.stdout.length} chars]` : undefined,
    stderr: showOutput ? run.stderr : run.stderr ? `[redacted ${run.stderr.length} chars]` : undefined,
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
  return { ...run };
}

export function publicWorkflowStepRun(run: WorkflowStepRun, showOutput = false): Record<string, unknown> {
  return {
    ...run,
    stdout: showOutput ? run.stdout : run.stdout ? `[redacted ${run.stdout.length} chars]` : undefined,
    stderr: showOutput ? run.stderr : run.stderr ? `[redacted ${run.stderr.length} chars]` : undefined,
  };
}

export function publicWorkflowEvent(event: WorkflowEvent): Record<string, unknown> {
  return { ...event };
}
