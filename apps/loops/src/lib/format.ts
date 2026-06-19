import type { Loop, LoopRun, WorkflowEvent, WorkflowRun, WorkflowSpec, WorkflowStepRun } from "../types.js";

export function redact(value: string | undefined, visible = 80): string | undefined {
  if (!value) return value;
  if (value.length <= visible) return value;
  return `${value.slice(0, visible)}... [redacted ${value.length - visible} chars]`;
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
