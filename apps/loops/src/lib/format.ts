import type { Loop, LoopRun } from "../types.js";

export function redact(value: string | undefined, visible = 80): string | undefined {
  if (!value) return value;
  if (value.length <= visible) return value;
  return `${value.slice(0, visible)}... [redacted ${value.length - visible} chars]`;
}

export function publicLoop(loop: Loop): Record<string, unknown> {
  const target =
    loop.target.type === "command"
      ? { ...loop.target, env: loop.target.env ? "[redacted]" : undefined }
      : { ...loop.target, prompt: redact(loop.target.prompt) };
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
