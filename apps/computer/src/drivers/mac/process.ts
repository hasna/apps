export interface MacProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
}

export interface MacProcessOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAC_PROCESS_TIMEOUT_MS = 15_000;

export async function runMacProcess(command: string[], options: MacProcessOptions = {}): Promise<MacProcessResult> {
  if (options.signal?.aborted) {
    return {
      stdout: "",
      stderr: formatAbortSignalReason(options.signal),
      exitCode: 130,
      timedOut: false,
      aborted: true,
    };
  }

  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_MAC_PROCESS_TIMEOUT_MS);
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let aborted = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  const abort = () => {
    aborted = true;
    proc.kill("SIGKILL");
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  const exitCode = await proc.exited.finally(() => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return {
    stdout,
    stderr: aborted && !stderr ? formatAbortSignalReason(options.signal) : stderr,
    exitCode: timedOut ? 124 : aborted ? 130 : exitCode,
    timedOut,
    aborted,
  };
}

export function formatMacProcessFailure(command: string[], result: MacProcessResult): string {
  if (result.aborted) return `${command[0]} cancelled: ${result.stderr}`;
  if (result.timedOut) return `${command[0]} timed out after controlled timeout`;
  return `${command[0]} failed: ${result.stderr}`;
}

export function formatAbortSignalReason(signal?: AbortSignal): string {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string" && reason.trim().length > 0) return reason;
  return "Action cancelled";
}
