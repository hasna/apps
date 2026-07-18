#!/usr/bin/env bun
import { Command } from "commander";
import type {
  ExecutorResult,
  Goal,
  GoalPlanNode,
  GoalRun,
  GoalStatus,
  Loop,
  LoopRun,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSpec,
  WorkflowStepRun,
} from "../types.js";
import { executeLoop } from "../lib/executor.js";
import { executeLoopTarget, type WorkflowExecutionStore } from "../lib/workflow-runner.js";
import { buildDeploymentStatus, deploymentStatusLine } from "../lib/mode.js";
import { packageVersion } from "../lib/version.js";

const program = new Command();
const DEFAULT_RUNNER_ID = `runner:${process.pid}`;
const MIN_RUNNER_LEASE_MS = 1_000;
const DEFAULT_RUNNER_POLL_INTERVAL_MS = 5_000;
// After this many consecutive heartbeat failures the control plane has almost
// certainly expired our lease (and may have handed the run to another runner),
// so we abort execution instead of racing a second executor.
const MAX_CONSECUTIVE_HEARTBEAT_FAILURES = 3;

program
  .name("loops-runner")
  .description("OpenLoops control-plane runner")
  .version(packageVersion())
  .option("-j, --json", "print JSON");

function configuredApiUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HASNA_LOOPS_API_URL?.trim();
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
  workflow?: WorkflowSpec;
}

export interface RunnerOnceResult {
  ok: boolean;
  claimed: number;
  completed: LoopRun[];
}

export interface RunnerLoopResult extends RunnerOnceResult {
  iterations: number;
  errors: number;
  idle: boolean;
  stopped: boolean;
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

export interface RunRunnerLoopOptions extends RunRunnerOnceOptions {
  pollIntervalMs?: number;
  maxIterations?: number;
  idleExitAfterMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  nowMs?: () => number;
  onError?: (error: unknown) => void;
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

class RunnerWorkflowApiStore implements WorkflowExecutionStore {
  readonly serverDerivedAgentSessionContracts = true;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly config: { apiUrl: string; token?: string },
    private readonly claim: RunnerApiClaim,
  ) {}

  private workflowRunPath(workflowRunId: string, suffix = ""): string {
    return `/v1/runs/${encodeURIComponent(this.claim.run.id)}/workflow-runs/${encodeURIComponent(workflowRunId)}${suffix}`;
  }

  private goalPath(goalId: string, suffix = ""): string {
    return `/v1/runs/${encodeURIComponent(this.claim.run.id)}/goals/${encodeURIComponent(goalId)}${suffix}`;
  }

  private stepPath(workflowRunId: string, stepId: string, action: string): string {
    return `${this.workflowRunPath(workflowRunId)}/steps/${encodeURIComponent(stepId)}/${action}`;
  }

  private async post(path: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return postJson(this.fetchImpl, this.config, path, { claimToken: this.claim.claimToken, ...body });
  }

  async requireWorkflow(idOrName: string): Promise<WorkflowSpec> {
    if (this.claim.workflow && (this.claim.workflow.id === idOrName || this.claim.workflow.name === idOrName)) return this.claim.workflow;
    throw new Error(`workflow not included in runner claim: ${idOrName}`);
  }

  async createWorkflowRun(input: Parameters<WorkflowExecutionStore["createWorkflowRun"]>[0]): Promise<WorkflowRun> {
    const raw = await this.post(`/v1/runs/${encodeURIComponent(this.claim.run.id)}/workflow-runs`, {
      scheduledFor: input.scheduledFor,
      idempotencyKey: input.idempotencyKey,
    });
    return raw.workflowRun as WorkflowRun;
  }

  async getWorkflowRun(id: string): Promise<WorkflowRun | undefined> {
    const raw = await this.post(this.workflowRunPath(id, "/get"));
    return raw.workflowRun as WorkflowRun | undefined;
  }

  async requireWorkflowRun(id: string): Promise<WorkflowRun> {
    const run = await this.getWorkflowRun(id);
    if (!run) throw new Error(`workflow run not found: ${id}`);
    return run;
  }

  async listWorkflowStepRuns(workflowRunId: string): Promise<WorkflowStepRun[]> {
    const raw = await this.post(this.workflowRunPath(workflowRunId, "/steps"));
    return (Array.isArray(raw.steps) ? raw.steps : []) as WorkflowStepRun[];
  }

  async getWorkflowStepRun(workflowRunId: string, stepId: string): Promise<WorkflowStepRun | undefined> {
    const raw = await this.post(this.stepPath(workflowRunId, stepId, "get"));
    return raw.step as WorkflowStepRun | undefined;
  }

  async isWorkflowRunTerminal(workflowRunId: string): Promise<boolean> {
    const run = await this.getWorkflowRun(workflowRunId);
    return Boolean(run && ["succeeded", "failed", "timed_out", "cancelled"].includes(run.status));
  }

  async startWorkflowStepRun(workflowRunId: string, stepId: string): Promise<WorkflowStepRun> {
    return (await this.post(this.stepPath(workflowRunId, stepId, "start"))).step as WorkflowStepRun;
  }

  async recoverWorkflowRun(workflowRunId: string, reason?: string): Promise<{ run: WorkflowRun; recoveredSteps: WorkflowStepRun[] }> {
    const raw = await this.post(this.workflowRunPath(workflowRunId, "/recover"), { reason });
    return {
      run: raw.workflowRun as WorkflowRun,
      recoveredSteps: (Array.isArray(raw.recoveredSteps) ? raw.recoveredSteps : []) as WorkflowStepRun[],
    };
  }

  async finalizeWorkflowStepRun(
    workflowRunId: string,
    stepId: string,
    patch: Pick<WorkflowStepRun, "status" | "finishedAt" | "durationMs" | "stdout" | "stderr"> &
      Partial<Pick<WorkflowStepRun, "exitCode" | "error">>,
  ): Promise<WorkflowStepRun> {
    return (await this.post(this.stepPath(workflowRunId, stepId, "finalize"), patch as unknown as Record<string, unknown>)).step as WorkflowStepRun;
  }

  async finalizeWorkflowRun(
    workflowRunId: string,
    status: WorkflowRunStatus,
    patch: Partial<Pick<WorkflowRun, "finishedAt" | "durationMs" | "error">> = {},
  ): Promise<WorkflowRun> {
    return (await this.post(this.workflowRunPath(workflowRunId, "/finalize"), {
      status,
      ...patch,
    })).workflowRun as WorkflowRun;
  }

  async markWorkflowStepPid(workflowRunId: string, stepId: string, pid: number): Promise<WorkflowStepRun> {
    return (await this.post(this.stepPath(workflowRunId, stepId, "pid"), { pid })).step as WorkflowStepRun;
  }

  async recordWorkflowStepProgress(
    workflowRunId: string,
    stepId: string,
    progress: { stdout?: string; stderr?: string; payload?: Record<string, unknown> },
  ): Promise<WorkflowStepRun> {
    return (await this.post(this.stepPath(workflowRunId, stepId, "progress"), progress)).step as WorkflowStepRun;
  }

  async appendWorkflowEvent(
    workflowRunId: string,
    eventType: string,
    stepId?: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    return (await this.post(this.workflowRunPath(workflowRunId, "/events"), { eventType, stepId, payload })).event;
  }

  async skipWorkflowStepRun(workflowRunId: string, stepId: string, reason: string): Promise<WorkflowStepRun> {
    return (await this.post(this.stepPath(workflowRunId, stepId, "skip"), { reason })).step as WorkflowStepRun;
  }

  async findGoalByContext(context: Parameters<WorkflowExecutionStore["findGoalByContext"]>[0]): Promise<Goal | undefined> {
    return (await this.post(`/v1/runs/${encodeURIComponent(this.claim.run.id)}/goals/find`, { context })).goal as Goal | undefined;
  }

  async createGoal(input: Parameters<WorkflowExecutionStore["createGoal"]>[0]): Promise<Goal> {
    return (await this.post(`/v1/runs/${encodeURIComponent(this.claim.run.id)}/goals`, { input })).goal as Goal;
  }

  async requireGoal(id: string): Promise<Goal> {
    return (await this.post(this.goalPath(id, "/get"))).goal as Goal;
  }

  async createGoalPlanNodes(goalId: string, nodes: Parameters<WorkflowExecutionStore["createGoalPlanNodes"]>[1]): Promise<GoalPlanNode[]> {
    const raw = await this.post(this.goalPath(goalId, "/plan-nodes"), { nodes });
    return (Array.isArray(raw.nodes) ? raw.nodes : []) as GoalPlanNode[];
  }

  async listGoalPlanNodes(goalIdOrPlanId: string): Promise<GoalPlanNode[]> {
    const raw = await this.post(this.goalPath(goalIdOrPlanId, "/plan-nodes/list"));
    return (Array.isArray(raw.nodes) ? raw.nodes : []) as GoalPlanNode[];
  }

  async updateGoalStatus(goalId: string, status: GoalStatus): Promise<Goal> {
    return (await this.post(this.goalPath(goalId, "/status"), { status })).goal as Goal;
  }

  async updateGoalPlanNode(
    goalId: string,
    key: string,
    patch: Partial<Pick<GoalPlanNode, "status" | "tokensUsed" | "timeUsedSeconds" | "ready">>,
  ): Promise<GoalPlanNode> {
    return (await this.post(this.goalPath(goalId, `/plan-nodes/${encodeURIComponent(key)}`), patch as Record<string, unknown>)).node as GoalPlanNode;
  }

  async recordGoalEvent(input: Parameters<WorkflowExecutionStore["recordGoalEvent"]>[0]): Promise<GoalRun> {
    return (await this.post(this.goalPath(input.goalId, "/events"), input as unknown as Record<string, unknown>)).goalRun as GoalRun;
  }
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

export async function runRunnerLoop(opts: RunRunnerLoopOptions = {}): Promise<RunnerLoopResult> {
  resolveRunnerConfig(opts);
  const pollIntervalMs = normalizedInteger(opts.pollIntervalMs ?? DEFAULT_RUNNER_POLL_INTERVAL_MS, "pollIntervalMs", 1);
  const maxIterations = opts.maxIterations === undefined
    ? undefined
    : normalizedInteger(opts.maxIterations, "maxIterations", 1);
  const idleExitAfterMs = opts.idleExitAfterMs === undefined
    ? undefined
    : normalizedInteger(opts.idleExitAfterMs, "idleExitAfterMs", 0);
  const sleep = opts.sleep ?? sleepMs;
  const nowMs = opts.nowMs ?? (() => Date.now());
  const completed: LoopRun[] = [];
  let ok = true;
  let iterations = 0;
  let claimed = 0;
  let errors = 0;
  let idle = false;
  let lastClaimedAt = nowMs();

  while (!opts.signal?.aborted && (maxIterations === undefined || iterations < maxIterations)) {
    iterations += 1;
    let claimedThisIteration = 0;
    try {
      const result = await runRunnerOnce(opts);
      claimedThisIteration = result.claimed;
      claimed += result.claimed;
      completed.push(...result.completed);
      if (!result.ok) ok = false;
      if (result.claimed > 0) lastClaimedAt = nowMs();
    } catch (error) {
      errors += 1;
      ok = false;
      opts.onError?.(error);
    }

    if (idleExitAfterMs !== undefined && nowMs() - lastClaimedAt >= idleExitAfterMs) {
      idle = true;
      break;
    }
    if (opts.signal?.aborted || (maxIterations !== undefined && iterations >= maxIterations)) break;
    if (claimedThisIteration === 0) await sleep(pollIntervalMs, opts.signal);
  }

  return {
    ok: ok && errors === 0,
    claimed,
    completed,
    iterations,
    errors,
    idle,
    stopped: Boolean(opts.signal?.aborted),
  };
}

async function executeClaimWithHeartbeat(
  fetchImpl: typeof fetch,
  config: { apiUrl: string; token?: string },
  claim: RunnerApiClaim,
  opts: RunRunnerOnceOptions,
): Promise<ExecutorResult> {
  const execute = opts.execute ?? (
    claim.loop.target.type === "workflow"
      ? ((loop, run, executeOpts) => {
          const workflowId = claim.loop.target.type === "workflow" ? claim.loop.target.workflowId : "unknown";
          if (!claim.workflow) throw new Error(`runner claim for workflow loop ${loop.id} did not include workflow ${workflowId}`);
          return executeLoopTarget(new RunnerWorkflowApiStore(fetchImpl, config, claim), loop, run, executeOpts);
        })
      : executeLoop
  );
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

function normalizedInteger(value: number, name: string, min: number): number {
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`);
  return value;
}

function parseIntegerOption(name: string, min: number): (value: string) => number {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min) throw new Error(`${name} must be an integer >= ${min}`);
    return parsed;
  };
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

function shutdownSignal(): AbortSignal {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return controller.signal;
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

program
  .command("run")
  .description("poll the control-plane and execute claimed runs until stopped")
  .option("--api-url <url>", "control-plane API URL")
  .option("--runner-id <id>", "runner id")
  .option("--machine-id <id>", "machine id")
  .option("--poll-interval-ms <ms>", "idle polling interval", parseIntegerOption("pollIntervalMs", 1))
  .option("--max-iterations <n>", "stop after this many claim iterations", parseIntegerOption("maxIterations", 1))
  .option("--idle-exit-after-ms <ms>", "stop after this many idle milliseconds", parseIntegerOption("idleExitAfterMs", 0))
  .option("-j, --json", "print JSON")
  .action(async (opts) => {
    const result = await runRunnerLoop({
      apiUrl: opts.apiUrl,
      runnerId: opts.runnerId,
      machineId: opts.machineId,
      pollIntervalMs: opts.pollIntervalMs,
      maxIterations: opts.maxIterations,
      idleExitAfterMs: opts.idleExitAfterMs,
      signal: shutdownSignal(),
    });
    if (wantsJson(opts)) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `iterations=${result.iterations} claimed=${result.claimed} completed=${result.completed.length} errors=${result.errors}`,
      );
    }
    if (!result.ok) process.exitCode = 1;
  });

if (import.meta.main) {
  main().catch((error) => {
    logRunnerCommandFailure(error);
    process.exit(1);
  });
}

export function logRunnerCommandFailure(error: unknown): void {
  console.error(JSON.stringify({
    evt: "loops_runner_command_failed",
    errorType: error instanceof Error ? "error" : typeof error,
  }));
}
