#!/usr/bin/env bun
import { Command } from "commander";
import type { ExecutorResult, Loop, LoopRun } from "../types.js";
import { executeLoop } from "../lib/executor.js";
import { buildDeploymentStatus, deploymentStatusLine } from "../lib/mode.js";
import { packageVersion } from "../lib/version.js";

const program = new Command();
const DEFAULT_RUNNER_ID = `runner:${process.pid}`;
const MIN_RUNNER_LEASE_MS = 1_000;
// After this many consecutive heartbeat failures the control plane has almost
// certainly expired our lease (and may have handed the run to another runner),
// so we abort execution instead of racing a second executor.
const MAX_CONSECUTIVE_HEARTBEAT_FAILURES = 3;

program
  .name("loops-runner")
  .description("OpenLoops control-plane runner foundation")
  .version(packageVersion())
  .option("-j, --json", "print JSON");

function configuredApiUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HASNA_LOOPS_API_URL?.trim() || env.HASNA_LOOPS_CLOUD_API_URL?.trim();
}

function configuredApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HASNA_LOOPS_API_KEY?.trim();
}

export function runnerStatus(machineId = process.env.LOOPS_RUNNER_MACHINE_ID || process.env.HASNA_MACHINE_ID) {
  const deployment = buildDeploymentStatus();
  const local = deployment.deploymentMode === "local";
  const apiUrl = configuredApiUrl();
  const token = configuredApiKey();
  const apiReady = Boolean(apiUrl && token);
  return {
    ok: local || apiReady,
    service: "loops-runner",
    machineId,
    deployment,
    state: local
      ? "local_daemon_authoritative"
      : apiReady
        ? "control_plane_ready"
        : apiUrl
          ? "missing_control_plane_token"
          : "missing_control_plane_api_url",
  };
}

export interface RunnerApiClaim {
  loop: Loop;
  run: LoopRun;
  claimToken: string;
}

export interface RunnerOnceResult {
  ok: boolean;
  claimed: number;
  completed: LoopRun[];
}

export interface RunRunnerOnceOptions {
  apiUrl?: string;
  apiKey?: string;
  runnerId?: string;
  machineId?: string;
  now?: Date;
  heartbeatIntervalMs?: number;
  fetchImpl?: typeof fetch;
  execute?: (loop: Loop, run: LoopRun, opts?: { signal?: AbortSignal }) => Promise<ExecutorResult>;
  env?: NodeJS.ProcessEnv;
}

function resolveRunnerConfig(opts: RunRunnerOnceOptions): { apiUrl: string; token?: string; runnerId: string; machineId?: string } {
  const env = opts.env ?? process.env;
  const apiUrl = opts.apiUrl ?? configuredApiUrl(env);
  if (!apiUrl) throw new Error("loops-runner requires HASNA_LOOPS_API_URL");
  const token = opts.apiKey ?? configuredApiKey(env);
  if (!token) throw new Error("loops-runner requires HASNA_LOOPS_API_KEY");
  return {
    apiUrl,
    token,
    runnerId: opts.runnerId ?? env.LOOPS_RUNNER_ID ?? env.LOOPS_RUNNER_MACHINE_ID ?? env.HASNA_MACHINE_ID ?? DEFAULT_RUNNER_ID,
    machineId: opts.machineId ?? env.LOOPS_RUNNER_MACHINE_ID ?? env.HASNA_MACHINE_ID,
  };
}

function endpoint(base: string, path: string): string {
  return new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`).toString();
}

async function postJson(fetchImpl: typeof fetch, config: { apiUrl: string; token?: string }, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetchImpl(endpoint(config.apiUrl, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `loops-api request failed: ${response.status}`);
  return payload;
}

export async function runRunnerOnce(opts: RunRunnerOnceOptions = {}): Promise<RunnerOnceResult> {
  const config = resolveRunnerConfig(opts);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const runnerBody = {
    runnerId: config.runnerId,
    machineId: config.machineId,
    now: (opts.now ?? new Date()).toISOString(),
    maxClaims: 1,
  };
  await postJson(fetchImpl, config, "/v1/runners/register", runnerBody);
  const claimed = await postJson(fetchImpl, config, "/v1/runners/claim", runnerBody);
  const claims = (Array.isArray(claimed.claims) ? claimed.claims : []) as RunnerApiClaim[];
  const completed: LoopRun[] = [];
  for (const claim of claims) {
    const result = await executeClaimWithHeartbeat(fetchImpl, config, claim, opts);
    const finalized = await postJson(fetchImpl, config, `/v1/runs/${claim.run.id}/finalize`, {
      claimToken: claim.claimToken,
      status: result.status,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
      exitCode: result.exitCode,
      pid: result.pid,
    });
    const run = (finalized.run ?? claim.run) as LoopRun;
    completed.push(run);
  }
  return { ok: completed.every((run) => run.status === "succeeded"), claimed: claims.length, completed };
}

async function executeClaimWithHeartbeat(
  fetchImpl: typeof fetch,
  config: { apiUrl: string; token?: string },
  claim: RunnerApiClaim,
  opts: RunRunnerOnceOptions,
): Promise<ExecutorResult> {
  const execute = opts.execute ?? executeLoop;
  const leaseMs = runnerLeaseMs(claim.loop.leaseMs);
  const heartbeatIntervalMs = runnerHeartbeatIntervalMs(leaseMs, opts.heartbeatIntervalMs);
  const heartbeat = async () => {
    await postJson(fetchImpl, config, `/v1/runs/${claim.run.id}/heartbeat`, {
      claimToken: claim.claimToken,
      leaseMs,
    });
  };
  await heartbeat();
  // Lost-lease safety: if heartbeats stop landing, the control plane will expire
  // our lease and may reassign the run. Abort execution after N consecutive
  // failures so we do not keep running (and later try to finalize) a run another
  // runner now owns. A successful heartbeat resets the streak.
  const controller = new AbortController();
  let consecutiveFailures = 0;
  const timer = setInterval(() => {
    void heartbeat().then(
      () => {
        consecutiveFailures = 0;
      },
      () => {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_HEARTBEAT_FAILURES && !controller.signal.aborted) {
          controller.abort();
        }
      },
    );
  }, heartbeatIntervalMs);
  try {
    return await execute(claim.loop, claim.run, { signal: controller.signal });
  } finally {
    clearInterval(timer);
  }
}

function runnerLeaseMs(leaseMs: number): number {
  return Math.max(MIN_RUNNER_LEASE_MS, leaseMs);
}

function runnerHeartbeatIntervalMs(leaseMs: number, configured?: number): number {
  const boundedLeaseMs = Number.isFinite(leaseMs) && leaseMs > 0 ? leaseMs : 30_000;
  const safeDefault = Math.max(1, Math.floor(boundedLeaseMs / 2));
  const requested = configured === undefined ? safeDefault : Math.max(1, Math.floor(configured));
  return Math.min(30_000, safeDefault, requested);
}

function wantsJson(opts?: { json?: boolean }): boolean {
  return Boolean(program.opts().json || opts?.json);
}

function printStatus(opts?: { json?: boolean }): void {
  const status = runnerStatus();
  if (wantsJson(opts)) console.log(JSON.stringify(status, null, 2));
  else console.log(`${deploymentStatusLine(status.deployment)} runner=${status.state}${status.machineId ? ` machine=${status.machineId}` : ""}`);
  if (!status.ok) process.exitCode = 1;
}

export async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv);
}

program.action(() => printStatus());

program.command("status").option("-j, --json", "print JSON").action((opts) => printStatus(opts));

program
  .command("run-once")
  .description("claim and execute one control-plane run")
  .option("--api-url <url>", "control-plane API URL")
  .option("--runner-id <id>", "runner id")
  .option("--machine-id <id>", "machine id")
  .option("-j, --json", "print JSON")
  .action(async (opts) => {
    const result = await runRunnerOnce({
      apiUrl: opts.apiUrl,
      runnerId: opts.runnerId,
      machineId: opts.machineId,
    });
    if (wantsJson(opts)) console.log(JSON.stringify(result, null, 2));
    else console.log(`claimed=${result.claimed} completed=${result.completed.length}`);
    if (!result.ok) process.exitCode = 1;
  });

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
