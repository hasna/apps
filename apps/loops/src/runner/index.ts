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
import { classifyLoopExecutionResult } from "../lib/loop-result.js";
import { executeLoopTarget, type WorkflowExecutionStore } from "../lib/workflow-runner.js";
import { resolveClientTransport, resolveCredential } from "@hasna/contracts/client";
import { loopControlPlaneConfig, type RuntimeConfig } from "../lib/runtime-config.js";
import { applyRunnerEnvFile } from "./env-file.js";
import { LoopsApiError, RunnerRefusalError, VersionProbeError } from "./errors.js";
import { createRunnerEpisodeRecorder, type RunnerEpisodeRecorder } from "./episodes.js";
export { LoopsApiError, RunnerRefusalError } from "./errors.js";
export {
  classifyRunnerFailure,
  createRunnerEpisodeRecorder,
  runnerEpisodesStatePath,
  runnerEventsOutboxPath,
  type RunnerEpisodeEvent,
  type RunnerEpisodeRecorder,
  type RunnerEpisodeRecorderOptions,
  type RunnerEpisodeStreak,
  type RunnerEpisodesFile,
  type RunnerFailureClass,
} from "./episodes.js";
import {
  installRunnerStartup,
  runnerServiceExitCode,
  runnerServiceStatus,
  startRunnerService,
  stopRunnerService,
} from "./install.js";
import {
  buildStorageConnectionReport,
  storageConnectionReportLine,
  type StorageConnectionReport,
} from "../lib/runtime-status.js";
import { packageVersion } from "../lib/version.js";
import {
  parseOperationAdmissionReceipt,
  parseOperationTerminalReceipt,
  parsePrivateOperationDescriptor,
  type OperationReceiptState,
  type PrivateOperationDescriptor,
} from "../lib/operation-contract.js";

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
  .description("Loops control-plane runner")
  .version(packageVersion())
  .option("-j, --json", "print JSON");

function configuredApiUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // The shared @hasna/contracts resolver decides the authority, fresh on every
  // call: HASNA_LOOPS_API_URL, the Keychain api-url item, the credential file,
  // then the fleet gateway — so a station needs no inline env prefix and a
  // rotation heals without a restart. The runner dials root-level paths
  // (/version) and /v1/... paths, so the transport's `<origin>/v1` base is
  // stripped back to the origin. A forbidden/refused URL propagates loudly; an
  // absent credential falls through to the caller's stable refusal message.
  try {
    return resolveClientTransport("loops", env).baseUrl.replace(/\/v1\/?$/, "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no API key could be resolved/.test(message)) throw error;
    return undefined;
  }
}

function configuredApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // The shared resolver's full chain: an explicit argument/override, the
  // Keychain item hasna.credentials.loops.api-key, the credential file
  // ~/.hasna/loops/config/credentials, then HASNA_LOOPS_API_KEY. A deliberate
  // tier that cannot be honoured throws rather than falling through.
  return resolveCredential("loops", env)?.apiKey;
}

/**
 * Runner authority, derived from the client connection only. Deployment modes
 * are removed: the runner is authoritative over the local file (the daemon),
 * or ready when a fully configured API connection (URL + key) exists.
 * Partial API configuration fails closed — the runner never claims work unless
 * the whole API connection is configured.
 */
export type RunnerState = "file_authoritative" | "api_ready" | "missing_api_url" | "missing_api_key";

export interface RunnerStatus {
  ok: boolean;
  service: "loops-runner";
  machineId?: string;
  state: RunnerState;
  storageConnection: StorageConnectionReport;
  /** Claim scope from the runner env file or environment, when configured. */
  claimScope?: RunnerClaimScope;
  /** Service-unit state when `loops-runner install` has run. */
  serviceState: {
    installed: boolean;
    active: boolean | null;
    unitPath?: string;
  };
}

export function runnerStatus(machineId = process.env.LOOPS_RUNNER_MACHINE_ID || process.env.HASNA_MACHINE_ID): RunnerStatus {
  const controlPlane = loopControlPlaneConfig();
  let apiReady = false;
  let resolvedApiUrl: string | undefined;
  try {
    // The shared credential resolver is the connection authority: env,
    // Keychain, credential file, then the fleet gateway once a credential has
    // resolved. A machine whose credential lives outside the environment
    // reports api_ready exactly like the data path would behave.
    resolvedApiUrl = resolveClientTransport("loops", process.env).baseUrl.replace(/\/v1\/?$/, "");
    apiReady = true;
  } catch {
    // Nothing resolves: fall back to the env-presence report so the state
    // still names which half is missing.
  }
  const state: RunnerState = apiReady
    ? "api_ready"
    : controlPlane.apiUrlPresent
      ? "missing_api_key"
      : controlPlane.apiKeyPresent
        ? "missing_api_url"
        : "file_authoritative";
  const config: RuntimeConfig = {
    storage: controlPlane.databaseUrlPresent ? "postgresql" : "sqlite",
    connection: apiReady ? "api" : "file",
    apiUrl: apiReady ? resolvedApiUrl : controlPlane.apiUrl,
    apiUrlPresent: apiReady || controlPlane.apiUrlPresent,
    apiKeyPresent: apiReady || controlPlane.apiKeyPresent,
    databaseUrlPresent: controlPlane.databaseUrlPresent,
  };
  const claimScopeValue = process.env.LOOPS_RUNNER_CLAIM_SCOPE?.trim();
  return {
    ok: state === "file_authoritative" || state === "api_ready",
    service: "loops-runner",
    machineId,
    state,
    storageConnection: buildStorageConnectionReport(config),
    ...(claimScopeValue === undefined || !RUNNER_CLAIM_SCOPES.includes(claimScopeValue as RunnerClaimScope)
      ? {}
      : { claimScope: claimScopeValue as RunnerClaimScope }),
    serviceState: runnerServiceStatus(),
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
  /** True when the loop terminated because of a PERMANENT control-plane denial (wrong_token_kind, expired, ...). */
  permanent: boolean;
  /** Actionable message for the permanent denial, when one stopped the loop. */
  permanentMessage?: string;
}

/** Exit code for a permanent credential/config denial, distinct from a generic transient failure (1). */
export const RUNNER_PERMANENT_DENIAL_EXIT_CODE = 4;

/**
 * `fleet` claims machine-unbound loops as well as loops pinned to this runner;
 * `bound` claims only pinned loops. The wire default is `fleet`, so a runner
 * that sends nothing behaves exactly as every runner did before this existed.
 */
export type RunnerClaimScope = "fleet" | "bound";

export const RUNNER_CLAIM_SCOPES: readonly RunnerClaimScope[] = ["fleet", "bound"];

/** Advertised on the open `/version` probe by a control plane that enforces claimScope. */
export const RUNNER_CLAIM_SCOPE_CAPABILITY = "runner.claimScope";

export interface RunRunnerOnceOptions {
  apiUrl?: string;
  apiKey?: string;
  runnerId?: string;
  machineId?: string;
  claimScope?: RunnerClaimScope;
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
  /** Failure-episode tracker; the CLI wires the default persisted recorder. */
  episodeRecorder?: RunnerEpisodeRecorder;
}

function resolveClaimScope(
  value: string | undefined,
  source: string,
): RunnerClaimScope | undefined {
  if (value === undefined || value === "") return undefined;
  if (!RUNNER_CLAIM_SCOPES.includes(value as RunnerClaimScope)) {
    throw new Error(
      `${source} must be one of: ${RUNNER_CLAIM_SCOPES.join(", ")} (got ${JSON.stringify(value)})`,
    );
  }
  return value as RunnerClaimScope;
}

function resolveRunnerConfig(opts: RunRunnerOnceOptions): {
  apiUrl: string;
  token?: string;
  runnerId: string;
  machineId?: string;
  claimScope?: RunnerClaimScope;
} {
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
    claimScope: resolveClaimScope(opts.claimScope, "claimScope")
      ?? resolveClaimScope(env.LOOPS_RUNNER_CLAIM_SCOPE, "LOOPS_RUNNER_CLAIM_SCOPE"),
  };
}

/**
 * A `bound` runner establishes that the control plane can actually enforce the
 * scope BEFORE it claims anything. There is no unclaim endpoint — `finalizeRun`
 * takes only terminal statuses — so a runner that discovers non-enforcement
 * from the claim response is already holding runs it cannot cleanly give back,
 * and the default lease is 30 minutes. The fix reaches npm long before it
 * reaches the control plane, so a non-enforcing server is the EXPECTED state on
 * day one, not an edge case. Fail closed: claim nothing.
 */
async function assertClaimScopeEnforceable(
  fetchImpl: typeof fetch,
  config: { apiUrl: string; token?: string },
): Promise<void> {
  let capabilities: unknown;
  try {
    const response = await fetchImpl(endpoint(config.apiUrl, "/version"), {
      method: "GET",
      headers: config.token ? { authorization: `Bearer ${config.token}` } : {},
    });
    if (!response.ok) throw new VersionProbeError(`HTTP ${response.status}`);
    try {
      capabilities = ((await response.json()) as Record<string, unknown>).capabilities;
    } catch {
      throw new VersionProbeError("a non-JSON body");
    }
  } catch (error) {
    // Foreign error text (fetch rejections, JSON parse failures) can carry
    // provider detail — URLs, connection strings — so it is never
    // interpolated into the surfaced refusal. Only this module's own probe
    // classifications are; everything else gets a static category.
    const detail = error instanceof VersionProbeError ? error.message : "the version request failed";
    throw new RunnerRefusalError(
      `loops-runner --claim-scope bound could not verify control-plane support (${detail}); refusing to claim`,
    );
  }
  const advertised = Array.isArray(capabilities) ? capabilities : [];
  if (!advertised.includes(RUNNER_CLAIM_SCOPE_CAPABILITY)) {
    throw new RunnerRefusalError(
      `loops-runner --claim-scope bound requires a control plane advertising ${RUNNER_CLAIM_SCOPE_CAPABILITY}; `
        + "this one does not, so the scope would be silently ignored and this runner would claim the whole fleet's "
        + "unbound loops. Refusing to claim.",
    );
  }
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
  // LoopsApiError carries the numeric status for failure classification; the
  // message stays what it always was and is never read by episode tracking.
  // The server's structured `error` token (when present) travels as `reason`
  // so the runner can tell a PERMANENT credential/config denial from a
  // transient failure before deciding to retry — exact set-membership only,
  // never surfaced as foreign text.
  if (!response.ok) {
    const reason = typeof payload.error === "string" ? payload.error : undefined;
    throw new LoopsApiError(
      reason ?? `loops-api request failed: ${response.status}`,
      response.status,
      reason,
      path,
    );
  }
  return payload;
}

/**
 * Server denial reasons that are PERMANENT configuration/credential errors,
 * never transient. Retrying them is pointless and is exactly what silently
 * stalls the fleet: a runner whose token is the wrong kind (or is expired,
 * revoked, unbound, or scope-insufficient) fails every claim, backs off and
 * retries forever, no loop ever fires, and the "hosted scheduler" looks idle
 * while every active loop's nextRunAt stays frozen. The runner must fail
 * LOUDLY and terminally on these so the operator sees the actionable message
 * instead of an endless silent retry loop.
 */
const PERMANENT_DENIAL_REASONS: ReadonlySet<string> = new Set([
  "wrong_token_kind",
  "insufficient_scope",
  "insufficient_role",
  "unbound_key",
  "expired",
  "revoked",
  "disabled",
  "key_record_mismatch",
  "tenant_suspended",
  "principal_suspended",
  "membership_suspended",
]);

/** Typed error for a permanent control-plane denial. The message is a known-safe, generated string (never provider output). */
export class RunnerPermanentDenialError extends Error {
  constructor(
    readonly reason: string,
    readonly route: string,
  ) {
    super(runnerDenialMessage(reason, route));
    this.name = "RunnerPermanentDenialError";
  }
}

function runnerDenialMessage(reason: string, route: string): string {
  if (reason === "wrong_token_kind") {
    return "loops-runner cannot authenticate to the control plane: the configured API token is NOT a `machine` or `service` token, and the runner routes require one. " +
      `The control plane rejected route ${route} with wrong_token_kind. Mint a machine/service token with scope loops:runner ` +
      "(scripts/issue-key.ts with KEY_TOKEN_KIND=machine|service and KEY_SCOPES=loops:runner), place it in HASNA_LOOPS_API_KEY " +
      "(or LOOPS_RUNNER_* token env), and restart this runner. Until then the hosted scheduler dispatches nothing.";
  }
  return `loops-runner was denied by the control plane (${reason} on ${route}). This is a permanent credential/configuration error, not a transient failure: ` +
    "fix the token/principal before restarting. Retrying will never clear it.";
}

/**
 * Convert a thrown server error into a {@link RunnerPermanentDenialError} when
 * it carries a known permanent denial reason; otherwise return undefined.
 */
export function runnerPermanentDenial(error: unknown): RunnerPermanentDenialError | undefined {
  if (!(error instanceof Error)) return undefined;
  const reason = (error as Error & { reason?: unknown }).reason;
  if (typeof reason !== "string" || !PERMANENT_DENIAL_REASONS.has(reason)) return undefined;
  const route = (error as Error & { route?: unknown }).route;
  return new RunnerPermanentDenialError(reason, typeof route === "string" ? route : "unknown");
}

class RunnerWorkflowApiStore implements WorkflowExecutionStore {
  readonly serverDerivedAgentSessionContracts = true;
  private readonly operationDescriptors = new Map<string, PrivateOperationDescriptor>();
  private readonly operationStates = new Map<string, OperationReceiptState>();

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
    for (const candidate of Array.isArray(raw.operationDescriptors) ? raw.operationDescriptors : []) {
      const descriptor = parsePrivateOperationDescriptor(candidate);
      this.operationDescriptors.set(`${descriptor.workflowRunId}:${descriptor.stepId}`, descriptor);
    }
    for (const candidate of Array.isArray(raw.operationStates) ? raw.operationStates : []) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("invalid private operation state from control plane");
      }
      const value = candidate as Record<string, unknown>;
      const descriptor = parsePrivateOperationDescriptor(value.descriptor);
      const state: OperationReceiptState = {
        descriptor,
        ...(value.admission === undefined ? {} : { admission: parseOperationAdmissionReceipt(value.admission) }),
        ...(value.terminal === undefined ? {} : { terminal: parseOperationTerminalReceipt(value.terminal) }),
      };
      this.operationStates.set(`${descriptor.workflowRunId}:${descriptor.stepId}`, state);
    }
    return raw.workflowRun as WorkflowRun;
  }

  async getPrivateOperationDescriptor(workflowRunId: string, stepId: string): Promise<PrivateOperationDescriptor> {
    const descriptor = this.operationDescriptors.get(`${workflowRunId}:${stepId}`);
    if (!descriptor) {
      throw new Error(`private operation descriptor not included for workflow step: ${workflowRunId}/${stepId}`);
    }
    return descriptor;
  }

  async getPrivateOperationState(workflowRunId: string, stepId: string): Promise<OperationReceiptState> {
    const state = this.operationStates.get(`${workflowRunId}:${stepId}`);
    if (!state) {
      throw new Error(`private operation state not included for workflow step: ${workflowRunId}/${stepId}`);
    }
    return state;
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
  if (config.claimScope === "bound") await assertClaimScopeEnforceable(fetchImpl, config);
  const runnerBody = {
    runnerId: config.runnerId,
    machineId: config.machineId,
    ...(config.claimScope ? { claimScope: config.claimScope } : {}),
    now: (opts.now ?? new Date()).toISOString(),
    maxClaims: 1,
  };
  let claimed: Record<string, unknown>;
  try {
    claimed = await postJson(fetchImpl, config, "/v1/runners/claim", runnerBody);
  } catch (error) {
    // A permanent credential/config denial surfaces as a typed, actionable
    // error (wrong_token_kind etc.) instead of a bare retryable failure.
    throw runnerPermanentDenial(error) ?? error;
  }
  // The capability list can drift from what the server actually parses; the echo
  // is generated from the parse itself, so it is the stronger of the two checks.
  if (config.claimScope === "bound") {
    const echoed = (claimed.runner as Record<string, unknown> | undefined)?.claimScope;
    if (echoed !== "bound") {
      // `echoed` is server-provided, so only its typeof is surfaced — never
      // the value itself — keeping the refusal message static by construction.
      throw new RunnerRefusalError(
        `loops-runner --claim-scope bound was not echoed by the control plane (got ${typeof echoed}); `
          + "the scope was not applied to this claim",
      );
    }
  }
  const claims = (Array.isArray(claimed.claims) ? claimed.claims : []) as RunnerApiClaim[];
  const completed: LoopRun[] = [];
  for (const claim of claims) {
    const executionResult = await executeClaimWithHeartbeat(fetchImpl, config, claim, opts);
    const result = classifyLoopExecutionResult(claim.loop, executionResult);
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
  return {
    ok: completed.every((run) => run.status === "succeeded" || run.status === "skipped"),
    claimed: claims.length,
    completed,
  };
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
  let permanent = false;
  let permanentMessage: string | undefined;
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
      // A poll that returned at all proves the control plane was reachable —
      // that is the success signal for failure episodes, independent of
      // whether the claimed run itself later reports failure.
      opts.episodeRecorder?.recordSuccess();
    } catch (error) {
      errors += 1;
      ok = false;
      opts.onError?.(error);
      opts.episodeRecorder?.recordFailure(error);
      // A permanent credential/config denial (wrong_token_kind, expired,
      // revoked, insufficient_scope, ...) will never clear by retrying. Stop
      // the loop so the failure is loud and terminal instead of the silent
      // infinite-backoff stall that froze the fleet's hosted scheduler.
      const denial = runnerPermanentDenial(error);
      if (denial) {
        permanent = true;
        permanentMessage = denial.message;
        break;
      }
    }

    if (idleExitAfterMs !== undefined && nowMs() - lastClaimedAt >= idleExitAfterMs) {
      idle = true;
      break;
    }
    if (opts.signal?.aborted || (maxIterations !== undefined && iterations >= maxIterations)) break;
    if (claimedThisIteration === 0) await sleep(pollIntervalMs, opts.signal);
  }

  return {
    ok: ok && errors === 0 && !permanent,
    claimed,
    completed,
    iterations,
    errors,
    idle,
    permanent,
    permanentMessage,
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
  else console.log(`${storageConnectionReportLine(status.storageConnection)} runner=${status.state}${status.machineId ? ` machine=${status.machineId}` : ""}`);
  if (!status.ok) process.exitCode = 1;
}

export async function main(argv = process.argv): Promise<void> {
  // The per-station mode-600 runner env file is the deployment config surface:
  // the control-plane URL and key plus the machine id and claim scope. Apply it
  // before parsing so every verb (run, status, ...) sees the deployed config
  // without the variables needing to exist in the caller's environment.
  applyRunnerEnvFile();
  await program.parseAsync(argv);
}

program.action(() => printStatus());

program.command("status").option("-j, --json", "print JSON").action((opts) => printStatus(opts));

program
  .command("install")
  .description(
    "install the package-owned runner service (systemd-user unit on Linux, launchd plist on macOS) "
      + "plus the mode-600 per-station env file; the credential lives in the env file, never in the unit",
  )
  .option("--claim-scope <scope>", "fleet (default) or bound; written into the env file and the service unit")
  .option("--machine-id <id>", "machine id used as the runner id (default: hostname)")
  .action((opts) => {
    const claimScope =
      opts.claimScope === undefined || opts.claimScope === "" ? undefined : resolveClaimScope(opts.claimScope, "claimScope");
    const result = installRunnerStartup({
      cliEntry: process.argv[1] ?? "loops-runner",
      claimScope,
      machineId: opts.machineId,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program.command("start").description("enable and start the runner service").action(async () => {
  const result = startRunnerService();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = runnerServiceExitCode(result);
});

program.command("stop").description("stop the runner service (the update path is version bump + restart)").action(async () => {
  const result = stopRunnerService();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = runnerServiceExitCode(result);
});

program
  .command("run-once")
  .description("claim and execute one control-plane run")
  .option("--api-url <url>", "control-plane API URL")
  .option("--runner-id <id>", "runner id")
  .option("--machine-id <id>", "machine id")
  .option(
    "--claim-scope <scope>",
    "fleet (default) claims machine-unbound loops too; bound claims only loops pinned to this runner",
  )
  .option("-j, --json", "print JSON")
  .action(async (opts) => {
    // Persisted failure episodes: a oneshot timer exits after every poll, so
    // the streak must live on disk to survive it. Detection is always on;
    // delivery binds through the outbox + optional notifier command. The
    // recorder uses the same runner id as the claim so events attribute
    // correctly; the recorder sanitizes it before persisting anything.
    const episodeRecorder = createRunnerEpisodeRecorder(opts.runnerId ? { runnerId: opts.runnerId } : {});
    try {
      const result = await runRunnerOnce({
        apiUrl: opts.apiUrl,
        runnerId: opts.runnerId,
        machineId: opts.machineId,
        claimScope: opts.claimScope,
      });
      episodeRecorder.recordSuccess();
      if (wantsJson(opts)) console.log(JSON.stringify(result, null, 2));
      else console.log(`claimed=${result.claimed} completed=${result.completed.length}`);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      episodeRecorder.recordFailure(error);
      throw error;
    }
  });

program
  .command("run")
  .description("poll the control-plane and execute claimed runs until stopped")
  .option("--api-url <url>", "control-plane API URL")
  .option("--runner-id <id>", "runner id")
  .option("--machine-id <id>", "machine id")
  .option(
    "--claim-scope <scope>",
    "fleet (default) claims machine-unbound loops too; bound claims only loops pinned to this runner",
  )
  .option("--poll-interval-ms <ms>", "idle polling interval", parseIntegerOption("pollIntervalMs", 1))
  .option("--max-iterations <n>", "stop after this many claim iterations", parseIntegerOption("maxIterations", 1))
  .option("--idle-exit-after-ms <ms>", "stop after this many idle milliseconds", parseIntegerOption("idleExitAfterMs", 0))
  .option("-j, --json", "print JSON")
  .action(async (opts) => {
    const result = await runRunnerLoop({
      apiUrl: opts.apiUrl,
      runnerId: opts.runnerId,
      machineId: opts.machineId,
      claimScope: opts.claimScope,
      pollIntervalMs: opts.pollIntervalMs,
      maxIterations: opts.maxIterations,
      idleExitAfterMs: opts.idleExitAfterMs,
      signal: shutdownSignal(),
      // A failing service poll must reach the journal, not vanish into the
      // loop's error counter: ten minutes of failing polls previously left the
      // journal with nothing but the unit start line.
      onError: (error) => logRunnerCommandFailure(error),
      // Persisted failure episodes: open ONE episode per outage, emit ONE
      // structured event, close with ONE recovery event. Never blocks a poll.
      episodeRecorder: createRunnerEpisodeRecorder(opts.runnerId ? { runnerId: opts.runnerId } : {}),
    });
    if (wantsJson(opts)) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `iterations=${result.iterations} claimed=${result.claimed} completed=${result.completed.length} errors=${result.errors}`,
      );
      if (result.permanent && result.permanentMessage) console.error(result.permanentMessage);
    }
    if (result.permanent) {
      process.exitCode = RUNNER_PERMANENT_DENIAL_EXIT_CODE;
    } else if (!result.ok) process.exitCode = 1;
  });

if (import.meta.main) {
  main().catch((error) => {
    // A permanent credential/config denial is terminal and actionable: surface
    // the message and exit with a distinct code (4) so a supervisor can tell
    // "the runner is misconfigured" from a transient outage instead of backing
    // off and retrying a permanent failure forever (the silent fleet stall).
    const denial = runnerPermanentDenial(error);
    if (denial) {
      console.error(denial.message);
      process.exit(RUNNER_PERMANENT_DENIAL_EXIT_CODE);
    }
    logRunnerCommandFailure(error);
    process.exit(1);
  });
}

export function logRunnerCommandFailure(error: unknown): void {
  const line: Record<string, unknown> = {
    evt: "loops_runner_command_failed",
    errorType: error instanceof Error ? "error" : typeof error,
  };
  // Messages surface for every error class — a runner that fails every poll
  // with only errorType is an undiagnosable monitor, and foreign errors are
  // exactly where the diagnosable reason lives (e.g. a wrong_token_kind 403
  // from the API via postJson). Credential safety is preserved by the
  // redactor below: URL userinfo — the place connection-string credentials
  // have been observed to live — is stripped while the host survives.
  // Non-Error throws fall back to String(). Bounded to 500.
  const raw = error instanceof Error ? error.message : String(error);
  line.message = redactUrlCredentials(raw).slice(0, 500);
  console.error(JSON.stringify(line));
}

/** Strip scheme://user:pass@host userinfo so the host survives and the
 *  credential span is dropped: postgres://user:secret@db.internal/loops →
 *  postgres://db.internal/loops. A raw @ inside userinfo must be
 *  percent-encoded per RFC 3986, so the first literal @ is the delimiter. */
function redactUrlCredentials(value: string): string {
  return value.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1");
}
