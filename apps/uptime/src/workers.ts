import type { CheckResult } from "./types.js";

export interface HostedPublicCheckRunner {
  runDueHostedPublicChecks(now?: Date, options?: { workspaceId?: string }): Promise<CheckResult[]>;
}

export interface HostedPublicChecksWorkerOptions {
  runner: HostedPublicCheckRunner;
  workspaceId?: string;
  intervalMs?: number;
  maxRuntimeMs?: number;
  maxIterations?: number;
  signal?: AbortSignal;
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onIteration?: (iteration: HostedPublicChecksWorkerIteration) => void;
}

export interface HostedPublicChecksWorkerIteration {
  iteration: number;
  checked: number;
  startedAt: string;
  finishedAt: string;
}

export interface HostedPublicChecksWorkerSummary {
  kind: "open-uptime.hosted-public-checks-worker";
  status: "completed" | "stopped";
  workspaceId: string | null;
  iterations: number;
  checked: number;
  startedAt: string;
  finishedAt: string;
}

const DEFAULT_INTERVAL_MS = 30_000;

export async function runHostedPublicChecksWorker(options: HostedPublicChecksWorkerOptions): Promise<HostedPublicChecksWorkerSummary> {
  const intervalMs = normalizePositiveInteger(options.intervalMs ?? DEFAULT_INTERVAL_MS, "intervalMs");
  const maxRuntimeMs = options.maxRuntimeMs === undefined ? undefined : normalizePositiveInteger(options.maxRuntimeMs, "maxRuntimeMs");
  const maxIterations = options.maxIterations === undefined ? undefined : normalizePositiveInteger(options.maxIterations, "maxIterations");
  const clock = options.now ?? (() => new Date());
  const sleep = options.sleep ?? abortableSleep;
  const startedAtDate = clock();
  const startedAt = startedAtDate.toISOString();
  const deadline = maxRuntimeMs === undefined ? undefined : startedAtDate.getTime() + maxRuntimeMs;
  let iterations = 0;
  let checked = 0;

  while (!options.signal?.aborted) {
    if (maxIterations !== undefined && iterations >= maxIterations) break;
    const now = clock();
    if (deadline !== undefined && now.getTime() >= deadline) break;

    const iteration = iterations + 1;
    const iterationStartedAt = now.toISOString();
    const results = await options.runner.runDueHostedPublicChecks(now, { workspaceId: options.workspaceId });
    const finishedAt = clock().toISOString();
    iterations = iteration;
    checked += results.length;
    options.onIteration?.({
      iteration,
      checked: results.length,
      startedAt: iterationStartedAt,
      finishedAt,
    });

    if (maxIterations !== undefined && iterations >= maxIterations) break;
    if (deadline !== undefined && clock().getTime() >= deadline) break;
    await sleep(intervalMs, options.signal);
  }

  return {
    kind: "open-uptime.hosted-public-checks-worker",
    status: options.signal?.aborted ? "stopped" : "completed",
    workspaceId: options.workspaceId?.trim() || null,
    iterations,
    checked,
    startedAt,
    finishedAt: clock().toISOString(),
  };
}

function normalizePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
