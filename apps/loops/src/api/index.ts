#!/usr/bin/env bun
import { Command } from "commander";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type {
  CreateLoopInput,
  CreateWorkflowInvocationInput,
  CreateWorkflowInput,
  Loop,
  LoopRun,
  LoopStatus,
  RecoveredLeaseRunSnapshotEntry,
  RunStatus,
  UpsertWorkflowWorkItemInput,
  StoredWorkflowEvent,
  WorkflowRunStatus,
  WorkflowSpec,
  WorkflowStep,
  WorkflowStepRunStatus,
  WorkflowWorkItemStatus,
  WriteRunReceiptInput,
} from "../types.js";
import type { GoalStatus } from "../lib/goal/types.js";
import {
  AmbiguousNameError,
  DuplicateWorkflowEventError,
  LegacyWorkflowRunProvenanceError,
  LoopAdvancementConflictError,
  LoopArchivedError,
  LoopMutationConflictError,
  LoopNotFoundError,
  RunFinalizationConflictError,
  ValidationError,
  validationErrorPublicDetails,
  WorkflowRunDefinitionConflictError,
  WorkflowRunHasLiveStepsError,
  WorkflowRunNotRunningError,
  WorkflowRunStepOwnershipUnverifiableError,
} from "../lib/errors.js";
import { validateAgentTarget, workflowStepAgentSessionContract } from "../lib/agent-adapter.js";
import { validateLoopMachineRef } from "../lib/machines.js";
import type { AgentSessionContract } from "../types.js";
import {
  publicGoal,
  publicGoalRun,
  publicLoop,
  publicRun,
  publicRunReceipt,
  publicWorkflow,
  publicWorkflowEvent,
  publicWorkflowInvocation,
  publicWorkflowRun,
  publicWorkflowStepRun,
  publicWorkflowWorkItem,
} from "../lib/format.js";
import { resolveRuntimeConfig, type Env } from "../lib/runtime-config.js";
import {
  buildStorageConnectionReport,
  storageConnectionReportLine,
} from "../lib/runtime-status.js";
import { dueSlots } from "../lib/recurrence.js";
import { classifyLoopExecutionStaleness } from "../lib/execution-staleness.js";
import {
  collectBreakerWindowRuns,
  loopAdvancementPatchMatchesCurrent,
  planLoopAdvancement,
  resolveBreakerThreshold,
  type CircuitBreakerThreshold,
} from "../lib/advancement.js";
import { normalizeLoopLabels } from "../lib/labels.js";
import { supportsConfiguredLoopSkip } from "../lib/loop-result.js";
import { isExpiresAfterRuns, isLeaseMs, isLoopStatus, isMaxAttempts, LOOP_STATUSES } from "../lib/loop-status.js";
import { normalizeRunCompletion } from "../lib/run-completion.js";
import { scrubSecretsDeep } from "../lib/redact.js";
import type { LoopStorageContract } from "../lib/storage/contract.js";
import type { BundleArtifactStorage } from "../lib/bundle/artifact-storage.js";
import { routePolicy, type RoutePolicy } from "../lib/auth/route-policy.js";
import type { TenantAuthContext, TenantAuthDecision } from "../lib/auth/tenant-auth.js";
import { packageVersion } from "../lib/version.js";
import {
  DEFAULT_OPERATION_LOOKUP_CAPS,
  isPrivateOperationEventType,
  lookupOperationReceiptState,
  operationAdmissionReceipt,
  parseOperationTerminalReceipt,
  parsePrivateOperationDescriptor,
  publicLoopMutationResult,
  type LoopMutationEnvelope,
  type PrivateOperationDescriptor,
} from "../lib/operation-contract.js";
import {
  BUNDLE_ERROR_STATUS,
  DEFAULT_BUNDLE_LIMIT_BYTES,
  handleBundlesIndexRequest,
  handleLoopBundleRequest,
} from "./bundles.js";
import openApiSpec from "../../openapi/loops.json" with { type: "json" };

/** The serve OpenAPI document (source of the generated SDK), version-synced. */
export function openApiDocument(): Record<string, unknown> {
  return { ...(openApiSpec as Record<string, unknown>), info: { ...(openApiSpec as { info?: object }).info, version: packageVersion() } };
}

const program = new Command();
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_EVIDENCE_LIMIT_BYTES = 256 * 1024;
// Bulk id-preserving import (POST /v1/import) accepts batches of full loop/run/
// workflow rows, so it needs a much larger body budget than single-object CRUD.
// The client batches by byte budget well under this ceiling.
const DEFAULT_IMPORT_LIMIT_BYTES = 32 * 1024 * 1024;
const MIN_RUNNER_LEASE_MS = 1_000;

program
  .name("loops-api")
  .description("Loops self-hosted control-plane API foundation")
  .version(packageVersion())
  .option("-j, --json", "print JSON");

function wantsJson(opts?: { json?: boolean }): boolean {
  return Boolean(program.opts().json || opts?.json);
}

function printStatus(opts?: { json?: boolean }): void {
  const report = buildStorageConnectionReport(resolveRuntimeConfig());
  if (wantsJson(opts)) console.log(JSON.stringify(apiStatus(), null, 2));
  else console.log(storageConnectionReportLine(report));
}

function ok(payload: Record<string, unknown> = {}, init?: ResponseInit): Response {
  return Response.json({ ok: true, ...payload }, init);
}

function fail(error: string, status: number, details?: Record<string, unknown>): Response {
  return Response.json({ ok: false, error, ...details }, { status });
}

export function apiStatus(env: Env = process.env) {
  return {
    ok: true,
    service: "loops-api",
    status: buildStorageConnectionReport(resolveRuntimeConfig(env)),
  };
}

export interface ApiAuthenticator {
  authenticate(
    headers: Headers,
    context: { method: string; path: string; policy: RoutePolicy },
  ): Promise<TenantAuthDecision>;
}

export interface LoopsApiServerOptions {
  host?: string;
  port?: number;
  storage?: LoopStorageContract;
  bodyLimitBytes?: number;
  evidenceLimitBytes?: number;
  importLimitBytes?: number;
  /** Body budget for the multipart bundle upload. Separate from the JSON limit. */
  bundleLimitBytes?: number;
  /** Object storage for bundle archives. Defaults to the environment-configured placement. */
  artifacts?: BundleArtifactStorage;
  now?: () => Date;
  random?: () => number;
  circuitBreakerThreshold?: CircuitBreakerThreshold;
  /**
   * API-key verifier (from `@hasna/contracts/auth`). When present, every
   * request outside the open foundation probes (`/health`, `/ready`,
   * `/version`, `/openapi.json`) must present a valid `loops:*` scoped key. This is
   * the internet-facing auth path (no bearer token, no loopback bypass).
   */
  authenticator?: ApiAuthenticator;
  withTenantStorage?: <T>(
    principal: TenantAuthContext,
    fn: (storage: LoopStorageContract) => Promise<T>,
  ) => Promise<T>;
  /**
   * Readiness probe. Should prove the storage backend is reachable AND fully
   * migrated. Returns a stable public code only. Defaults to a storage list probe.
   */
  readyCheck?: () => Promise<{
    ready: boolean;
    code?: "storage_unconfigured" | "storage_unreachable" | "auth_unreachable" | "unsafe_database_role" |
      "pending_migrations" | "unknown_migrations" | "migration_checksum_mismatch";
  }>;
}

/**
 * Capabilities an already-deployed control plane advertises on the open
 * `/version` probe, so a runner can tell an enforcing server from one that will
 * accept its claim body and ignore half of it. There is no unclaim endpoint, so
 * a runner that needs enforcement has to establish it BEFORE its first claim —
 * discovering non-enforcement from the response is already too late.
 */
const API_CAPABILITIES = ["runner.claimScope", "bundles"] as const;

/** Shared { status, version, storage, connection } envelope for /health, /ready, /version. */
function foundationEnvelope(
  status: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const config = resolveRuntimeConfig();
  return {
    status,
    version: packageVersion(),
    storage: config.storage,
    connection: config.connection,
    service: "loops",
    ...extra,
  };
}

/**
 * Strict health payload for the @hasna/contracts 0.10.6 `HealthResponseSchema`
 * ({ status, version, backend } — extra keys are rejected). This is the
 * conformance sample, not the wire envelope: the runtime /health probe serves
 * the richer foundationEnvelope ({ status, version, storage, connection }).
 * `backend` maps 1:1 from the runtime storage backend (sqlite | postgresql).
 */
export function contractHealthResponse(
  env: Env = process.env,
): { status: "ok"; version: string; backend: "sqlite" | "postgresql" } {
  const report = buildStorageConnectionReport(resolveRuntimeConfig(env));
  return {
    status: "ok",
    version: report.packageVersion,
    backend: report.storage,
  };
}

const PUBLIC_READINESS_CODES = new Set([
  "storage_unconfigured",
  "storage_unreachable",
  "auth_unreachable",
  "unsafe_database_role",
  "pending_migrations",
  "unknown_migrations",
  "migration_checksum_mismatch",
]);

export function createLoopsApiServer(opts: LoopsApiServerOptions = {}) {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8787;
  if (!opts.authenticator || !opts.withTenantStorage) {
    throw new Error("loops-api requires a tenant authenticator and request-scoped tenant storage");
  }
  const authenticator = opts.authenticator;
  const withTenantStorage = opts.withTenantStorage;
  const defaultReady = async (): Promise<{ ready: boolean; code?: string }> => {
    if (!opts.storage) return { ready: false, code: "storage_unconfigured" };
    try {
      await opts.storage.listLoops({ limit: 1 });
      return { ready: true };
    } catch {
      return { ready: false, code: "storage_unreachable" };
    }
  };
  const readyCheck = opts.readyCheck ?? defaultReady;
  return Bun.serve({
    hostname: host,
    port,
    idleTimeout: 60,
    async fetch(request) {
      const url = new URL(request.url);
      // ── Open foundation probes ({ status, version, storage, connection }) ──
      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
        return Response.json(foundationEnvelope("ok"));
      }
      if (request.method === "GET" && (url.pathname === "/version" || url.pathname === "/v1/version")) {
        return Response.json(foundationEnvelope("ok", { capabilities: [...API_CAPABILITIES] }));
      }
      if (request.method === "GET" && (url.pathname === "/ready" || url.pathname === "/readyz")) {
        const result = await readyCheck();
        const code = result.ready
          ? undefined
          : PUBLIC_READINESS_CODES.has(result.code ?? "")
            ? result.code
            : "storage_unreachable";
        return Response.json(
          foundationEnvelope(result.ready ? "ready" : "not_ready", code ? { code } : {}),
          { status: result.ready ? 200 : 503 },
        );
      }
      if (request.method === "GET" && url.pathname === "/openapi.json") {
        return Response.json(openApiDocument());
      }
      const policy = routePolicy(request.method, url.pathname);
      if (!policy) return fail("route_policy_missing", 403);
      let decision: TenantAuthDecision;
      try {
        decision = await authenticator.authenticate(request.headers, {
          method: request.method,
          path: url.pathname,
          policy,
        });
      } catch (error) {
        const requestId = requestIdentifier(request);
        logInternalFailure(request, error, "auth_unavailable", requestId);
        return Response.json(
          { ok: false, error: "auth_unavailable", requestId },
          { status: 503 },
        );
      }
      if (!decision.ok) {
        return Response.json(
          { ok: false, error: decision.reason, message: decision.message, requestId: decision.requestId },
          { status: decision.status },
        );
      }
      const principal = decision.principal;
      if (request.method === "GET" && url.pathname === "/status") {
        return Response.json(apiStatus());
      }
      const execute = (storage?: LoopStorageContract) => handleV1Request({
          request,
          url,
          storage,
          auth: principal,
          bodyLimitBytes: opts.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
          evidenceLimitBytes: opts.evidenceLimitBytes ?? DEFAULT_EVIDENCE_LIMIT_BYTES,
          importLimitBytes: opts.importLimitBytes ?? DEFAULT_IMPORT_LIMIT_BYTES,
          bundleLimitBytes: opts.bundleLimitBytes ?? DEFAULT_BUNDLE_LIMIT_BYTES,
          artifacts: opts.artifacts,
          now: opts.now ?? (() => new Date()),
          random: opts.random ?? Math.random,
          circuitBreakerThreshold: opts.circuitBreakerThreshold,
        });
      try {
        return await withTenantStorage(principal, (storage) => execute(storage));
      } catch (error) {
        const response = errorResponse(error);
        if (response.status >= 500) logInternalFailure(request, error, "internal_error", principal.requestId);
        return response;
      }
    },
  });
}

interface V1RequestContext {
  request: Request;
  url: URL;
  storage?: LoopStorageContract;
  auth: TenantAuthContext;
  bodyLimitBytes: number;
  evidenceLimitBytes: number;
  importLimitBytes: number;
  bundleLimitBytes?: number;
  now: () => Date;
  random: () => number;
  circuitBreakerThreshold?: CircuitBreakerThreshold;
  artifacts?: BundleArtifactStorage;
}

type RunnerGoalInput = Parameters<LoopStorageContract["createGoal"]>[0];
type RunnerGoalPlanNodeInput = Parameters<LoopStorageContract["createGoalPlanNodes"]>[1][number];
type RunnerGoalEventInput = Parameters<LoopStorageContract["recordGoalEvent"]>[0];
const HOSTED_STUCK_RUN_GRACE_MS = 10 * 60_000;
const HOSTED_STUCK_RUN_LIMIT = 100;
const HOSTED_STUCK_WORKFLOW_LIMIT = 100;
const HOSTED_STUCK_EVENT_LIMIT = 512;

async function handleV1Request(ctx: V1RequestContext): Promise<Response> {
  // Decode before routing: a malformed segment (bad percent-encoding) must be
  // a client error, never a crash in the shared entry (every route shares this
  // decode, so one %zz id used to 500 all routes, DELETE included).
  let segments: string[];
  try {
    segments = ctx.url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return fail("invalid_path_segment", 422);
  }
  if (segments[0] !== "v1") return fail("not_found", 404);
  if (ctx.request.method === "GET" && segments.length === 1) return ok({ service: "loops-api", version: "v1" });
  if (ctx.request.method === "GET" && segments[1] === "status") return Response.json(apiStatus());
  if (segments[1] === "import") return await handleImportRequest(ctx, segments.slice(2));
  if (segments[1] === "loops") return await handleLoopsRequest(ctx, segments.slice(2));
  if (segments[1] === "bundles" && segments.length === 2) {
    const response = await handleBundlesIndexRequest(bundleContext(ctx));
    if (response) return response;
    return fail("not_found", 404);
  }
  if (segments[1] === "loop-mutations") return await handleLoopMutationsRequest(ctx, segments.slice(2));
  if (segments[1] === "runs") return await handleRunsRequest(ctx, segments.slice(2));
  if (segments[1] === "receipts") return await handleReceiptsRequest(ctx, segments.slice(2));
  if (segments[1] === "workflows") return await handleWorkflowsRequest(ctx, segments.slice(2));
  if (segments[1] === "workflow-runs") return await handleWorkflowRunsRequest(ctx, segments.slice(2));
  if (segments[1] === "work-items") return await handleWorkItemsRequest(ctx, segments.slice(2));
  if (segments[1] === "invocations") return await handleInvocationsRequest(ctx, segments.slice(2));
  if (segments[1] === "goals") return await handleGoalsRequest(ctx, segments.slice(2));
  if (segments[1] === "goal-runs") return await handleGoalRunsRequest(ctx, segments.slice(2));
  if (segments[1] === "history") return await handleHistoryRequest(ctx, segments.slice(2));
  if (segments[1] === "runners") return await handleRunnerRequest(ctx, segments.slice(2));
  if (segments[1] === "leases" && segments[2] === "stuck" && ctx.request.method === "GET") {
    const storage = requireStorage(ctx.storage);
    const now = ctx.now();
    const latestSafeCutoff = new Date(now.getTime() - HOSTED_STUCK_RUN_GRACE_MS);
    const requestedCutoffRaw = ctx.url.searchParams.get("expiredBefore");
    const requestedCutoff = requestedCutoffRaw ? new Date(requestedCutoffRaw) : latestSafeCutoff;
    if (Number.isNaN(requestedCutoff.getTime())) throw apiError("invalid_expired_before", 422);
    const expiredBefore = requestedCutoff < latestSafeCutoff ? requestedCutoff : latestSafeCutoff;
    const page = await storage.listExpiredRunLeaseCandidates(expiredBefore, {
      limit: Math.min(optionalLimit(ctx.url.searchParams.get("limit")) ?? HOSTED_STUCK_RUN_LIMIT, HOSTED_STUCK_RUN_LIMIT),
    });
    return ok({
      report: {
        state: page.candidates.length > 0 ? "stuck" : "clear",
        expiredBefore: expiredBefore.toISOString(),
        candidates: page.candidates.map(publicStuckRunCandidate),
        truncated: page.truncated,
      },
    });
  }
  if (segments[1] === "leases" && segments[2] === "reconcile" && ctx.request.method === "POST") {
    if (ctx.auth.tokenKind === "machine" || !ctx.auth.roles.some((role) => role === "admin" || role === "service")) {
      return fail("maintenance_principal_required", 403);
    }
    const storage = requireStorage(ctx.storage);
    const body = await readJsonBody<{ candidates?: unknown }>(ctx.request, ctx.bodyLimitBytes);
    if (!Array.isArray(body.candidates) || body.candidates.length === 0 || body.candidates.length > HOSTED_STUCK_RUN_LIMIT) {
      throw apiError("invalid_stuck_run_candidates", 422);
    }
    const candidates = body.candidates.map(parseExpiredRunLeaseCandidate);
    const outcomes = [];
    const now = ctx.now();
    const latestSafeCutoff = new Date(now.getTime() - HOSTED_STUCK_RUN_GRACE_MS).toISOString();
    for (const candidate of candidates) {
      const current = await storage.getRun(candidate.runId);
      if (!current) {
        outcomes.push({ runId: candidate.runId, outcome: "conflict", reason: "run_not_found_in_scope" });
        continue;
      }
      if (current.status !== "running") {
        outcomes.push({
          runId: candidate.runId,
          outcome: current.status === "abandoned" && current.error?.includes("lease expired")
            ? "already_recovered"
            : "conflict",
          reason: current.status === "abandoned" ? undefined : `run_is_${current.status}`,
        });
        continue;
      }
      if (!current.leaseExpiresAt || current.leaseExpiresAt > latestSafeCutoff) {
        outcomes.push({
          runId: candidate.runId,
          outcome: "conflict",
          reason: "lease_not_past_recovery_grace",
        });
        continue;
      }
      if (
        current.loopId !== candidate.loopId ||
        stuckRunSnapshotId({
          runId: current.id,
          loopId: current.loopId,
          leaseExpiresAt: current.leaseExpiresAt,
          updatedAt: current.updatedAt,
        }) !== candidate.snapshotId
      ) {
        outcomes.push({ runId: candidate.runId, outcome: "conflict", reason: "candidate_snapshot_changed" });
        continue;
      }
      const workflowRuns = await storage.listWorkflowRuns({
        loopRunId: candidate.runId,
        limit: HOSTED_STUCK_WORKFLOW_LIMIT + 1,
      });
      if (workflowRuns.length > HOSTED_STUCK_WORKFLOW_LIMIT) {
        outcomes.push({ runId: candidate.runId, outcome: "conflict", reason: "workflow_lookup_cap_exceeded" });
        continue;
      }
      let operationRequiresReconciliation = false;
      let lookupCapExceeded = false;
      for (const workflowRun of workflowRuns) {
        const events = await storage.listWorkflowEvents(workflowRun.id, HOSTED_STUCK_EVENT_LIMIT + 1);
        if (events.length > HOSTED_STUCK_EVENT_LIMIT) {
          lookupCapExceeded = true;
          break;
        }
        const terminalStepIds = new Set(
          events
            .filter((event) => event.eventType === "private_operation_terminal")
            .map((event) => event.stepId),
        );
        if (events.some((event) =>
          event.eventType === "private_operation_admitted" && !terminalStepIds.has(event.stepId)
        )) {
          operationRequiresReconciliation = true;
          break;
        }
      }
      if (lookupCapExceeded) {
        outcomes.push({ runId: candidate.runId, outcome: "conflict", reason: "operation_lookup_cap_exceeded" });
        continue;
      }
      if (operationRequiresReconciliation) {
        outcomes.push({
          runId: candidate.runId,
          outcome: "operation_reconciliation_required",
          reason: "admitted_external_operation_will_not_be_repeated_blindly",
        });
        continue;
      }
      try {
        const recovered = await storage.recoverExpiredRunLeasesDetailed(now, {
          runId: candidate.runId,
          limit: 1,
          scanLimit: 1,
          expectedLeaseExpiresAt: current.leaseExpiresAt,
          expectedUpdatedAt: current.updatedAt,
          refuseAdmittedPrivateOperations: true,
        });
        if (recovered.operationReconciliationRequired.some((run) => run.id === candidate.runId)) {
          outcomes.push({
            runId: candidate.runId,
            outcome: "operation_reconciliation_required",
            reason: "admitted_external_operation_will_not_be_repeated_blindly",
          });
          continue;
        }
        if (recovered.abandoned.length !== 1) {
          outcomes.push({ runId: candidate.runId, outcome: "conflict", reason: "candidate_changed_during_recovery" });
          continue;
        }
        await advanceRecoveredRuns(storage, recovered.abandoned, {
          random: ctx.random,
          circuitBreakerThreshold: ctx.circuitBreakerThreshold,
        });
      } catch {
        // One candidate's recovery/advancement must not abort the whole batch:
        // report the per-run conflict and let the remaining candidates proceed.
        // The run stays recovered/abandoned and is retryable on a later pass.
        outcomes.push({ runId: candidate.runId, outcome: "conflict", reason: "advancement_failed" });
        continue;
      }
      outcomes.push({ runId: candidate.runId, outcome: "recovered" });
    }
    return ok({ reconciliation: { outcomes } });
  }
  if (segments[1] === "leases" && segments[2] === "recover" && ctx.request.method === "POST") {
    if (ctx.auth.tokenKind === "machine" || !ctx.auth.roles.some((role) => role === "admin" || role === "service")) {
      return fail("maintenance_principal_required", 403);
    }
    const storage = requireStorage(ctx.storage);
    const recovered = await storage.recoverExpiredRunLeasesDetailed(ctx.now(), {
      refuseAdmittedPrivateOperations: true,
    });
    const advancementDeferred = await advanceRecoveredLeaseRunPages(storage, {
      random: ctx.random,
      circuitBreakerThreshold: ctx.circuitBreakerThreshold,
    });
    return ok({
      abandoned: recovered.abandoned.map((run) => publicRun(run, false, { redactError: true })),
      deferred: recovered.deferred.map((run) => publicRun(run, false, { redactError: true })),
      advancementDeferred: advancementDeferred.map((run) => publicRun(run, false, { redactError: true })),
      reconciliation: { outcomes: operationReconciliationOutcomes(recovered.operationReconciliationRequired) },
    });
  }
  return fail("not_found", 404);
}

interface PublicStuckRunCandidate {
  runId: string;
  loopId: string;
  snapshotId: string;
}

interface StuckRunSnapshotSource {
  runId: string;
  loopId: string;
  leaseExpiresAt: string;
  updatedAt: string;
}

function stuckRunSnapshotId(candidate: StuckRunSnapshotSource): string {
  return `stuck_${createHash("sha256")
    .update(JSON.stringify([
      candidate.runId,
      candidate.loopId,
      candidate.leaseExpiresAt,
      candidate.updatedAt,
    ]))
    .digest("hex")}`;
}

function publicStuckRunCandidate(candidate: StuckRunSnapshotSource): PublicStuckRunCandidate {
  return {
    runId: candidate.runId,
    loopId: candidate.loopId,
    snapshotId: stuckRunSnapshotId(candidate),
  };
}

function operationReconciliationOutcomes(runs: readonly LoopRun[]) {
  return runs.map((run) => ({
    runId: run.id,
    outcome: "operation_reconciliation_required" as const,
    reason: "admitted_external_operation_will_not_be_repeated_blindly",
  }));
}

function parseExpiredRunLeaseCandidate(value: unknown): PublicStuckRunCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw apiError("invalid_stuck_run_candidate", 422);
  }
  const candidate = value as Record<string, unknown>;
  const runId = typeof candidate.runId === "string" ? candidate.runId.trim() : "";
  const loopId = typeof candidate.loopId === "string" ? candidate.loopId.trim() : "";
  const snapshotId = typeof candidate.snapshotId === "string" ? candidate.snapshotId.trim() : "";
  if (
    !runId ||
    !loopId ||
    !/^stuck_[a-f0-9]{64}$/.test(snapshotId)
  ) {
    throw apiError("invalid_stuck_run_candidate", 422);
  }
  return { runId, loopId, snapshotId };
}

interface ImportRequestBody {
  workflows?: WorkflowSpec[];
  loops?: Loop[];
  runs?: LoopRun[];
  replace?: boolean;
  preserveLoopScheduling?: boolean;
  preserveWorkflowActivation?: boolean;
}

function safeImportedWorkflow(workflow: WorkflowSpec, opts: { preserveWorkflowActivation: boolean }): WorkflowSpec {
  if (opts.preserveWorkflowActivation) return workflow;
  return { ...workflow, status: "archived" };
}

function safeImportedLoop(loop: Loop, opts: { preserveLoopScheduling: boolean }): Loop {
  if (opts.preserveLoopScheduling) return loop;
  return {
    ...loop,
    status: "paused",
    nextRunAt: undefined,
    retryScheduledFor: undefined,
  };
}

function validateImportedAgentTargets(workflows: WorkflowSpec[], loops: Loop[]): void {
  for (const [workflowIndex, workflow] of workflows.entries()) {
    for (const [stepIndex, step] of workflow.steps.entries()) {
      if (step.target.type === "agent") {
        validateAgentTarget(step.target, `workflows[${workflowIndex}].steps[${stepIndex}].target`);
      }
    }
  }
  for (const [loopIndex, loop] of loops.entries()) {
    if (loop.target.type === "agent") validateAgentTarget(loop.target, `loops[${loopIndex}].target`);
  }
}

/**
 * Bulk id-preserving import for a local->self-hosted backfill.
 *
 * Accepts batches of full `workflows` / `loops` / `runs` rows (the same public
 * shapes that `loops export` emits) and upserts them by id via the storage
 * `upsertMigration*` methods. Backfill safety is enforced at this API boundary:
 * workflows are archived and loops are paused with scheduling pointers cleared
 * unless explicit preserve flags are supplied. Rows are applied in FK-safe order
 * (workflows, then loops, then runs). Volatile `running` runs are skipped (they
 * carry lease/process ownership) and reported in `skippedRunning` rather than
 * failing the batch. This is the endpoint the migration module noted as the
 * missing "id-preserving import" surface for self-hosted push.
 */
async function handleImportRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  if (segments.length !== 0 || ctx.request.method !== "POST") return fail("not_found", 404);
  const storage = requireStorage(ctx.storage);
  const body = await readJsonBody<ImportRequestBody>(ctx.request, ctx.importLimitBytes);
  const replace = body.replace === true;
  const workflows = Array.isArray(body.workflows) ? body.workflows : [];
  const loops = Array.isArray(body.loops) ? body.loops : [];
  const runs = Array.isArray(body.runs) ? body.runs : [];
  validateImportedAgentTargets(workflows, loops);
  const preserveWorkflowActivation = body.preserveWorkflowActivation === true;
  const preserveLoopScheduling = body.preserveLoopScheduling === true;
  const imported = { workflows: 0, loops: 0, runs: 0 };
  let skippedRunning = 0;
  // FK-safe order: workflow_specs, then loops (loop_runs.loop_id REFERENCES
  // loops), then loop_runs.
  for (const workflow of workflows) {
    await storage.upsertMigrationWorkflow(safeImportedWorkflow(workflow, { preserveWorkflowActivation }), {
      replace: replace || !preserveWorkflowActivation,
    });
    imported.workflows += 1;
  }
  for (const loop of loops) {
    await storage.upsertMigrationLoop(safeImportedLoop(loop, { preserveLoopScheduling }), {
      replace: replace || !preserveLoopScheduling,
    });
    imported.loops += 1;
  }
  for (const run of runs) {
    if (run.status === "running") {
      skippedRunning += 1;
      continue;
    }
    await storage.upsertMigrationRun(run, { replace });
    imported.runs += 1;
  }
  return ok({ imported, skippedRunning });
}

async function handleLoopsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  if (segments.length === 0 && ctx.request.method === "GET") {
    const loops = await storage.listLoops({
      status: optionalEnum<LoopStatus>(ctx.url.searchParams.get("status"), LOOP_STATUSES),
      labels: labelsFromSearchParams(ctx.url.searchParams),
      limit: optionalLimit(ctx.url.searchParams.get("limit")),
      offset: optionalOffset(ctx.url.searchParams.get("offset")),
      includeArchived: optionalBoolean(ctx.url.searchParams.get("includeArchived")),
      archived: optionalBoolean(ctx.url.searchParams.get("archived")),
      name: optionalString(ctx.url.searchParams.get("name")),
    });
    return ok({ loops: loops.map(publicLoop) });
  }
  if (segments.length === 0 && ctx.request.method === "POST") {
    const body = await readJsonBody<CreateLoopInput>(ctx.request, ctx.bodyLimitBytes);
    if ("labels" in body) body.labels = normalizedLabels(body.labels);
    const target: unknown = body && typeof body === "object" ? (body as { target?: unknown }).target : undefined;
    if (target && typeof target === "object" && !Array.isArray(target) && (target as { type?: unknown }).type === "agent") {
      validateAgentTarget(target, "target");
    }
    // Fail-closed machine assignment: a machine value that is not a
    // well-formed ref would persist as machine_json the claim gate cannot
    // match, leaving the loop leased by nobody — the O15-00172 never-executes
    // state. A requested machine must carry a non-empty string id, or the
    // create is rejected before anything reaches storage.
    if ("machine" in body && body.machine !== undefined) {
      validateLoopMachineRef(body.machine, "machine");
    }
    const loop = await storage.createLoop(body);
    return ok({ loop: publicLoop(loop) }, { status: 201 });
  }
  // GET /v1/loops/count — total-row verification (the list route caps at 1000
  // with no offset, so counting a large backfilled table needs this).
  if (segments.length === 1 && segments[0] === "count" && ctx.request.method === "GET") {
    const count = await storage.countLoops(
      optionalEnum<LoopStatus>(ctx.url.searchParams.get("status"), LOOP_STATUSES),
      {
        includeArchived: optionalBoolean(ctx.url.searchParams.get("includeArchived")),
        archived: optionalBoolean(ctx.url.searchParams.get("archived")),
      },
    );
    return ok({ count });
  }
  const id = segments[0];
  if (!id) return fail("not_found", 404);
  if (segments.length === 1 && ctx.request.method === "GET") {
    const loop = await storage.getLoop(id);
    if (!loop) throw new LoopNotFoundError(id);
    // BUG 96c837b0: a machine-pinned loop with no runner serving its machine
    // stays due with zero runs and no error. A run row exists iff a runner
    // claimed the loop, so bounded run presence is the honest "has any runner
    // ever served it" signal. Computed on the single-loop read only, so the
    // list route keeps its O(1) per-row cost.
    const hasRuns = (await storage.listRuns({ loopId: loop.id, limit: 1 })).length > 0;
    const execution = classifyLoopExecutionStaleness(loop, { now: ctx.now(), hasRuns });
    return ok({ loop: { ...publicLoop(loop), execution } });
  }
  if (segments.length === 1 && ctx.request.method === "PATCH") {
    const body = requiredObjectRecord(
      await readJsonBody<unknown>(ctx.request, ctx.bodyLimitBytes),
    ) as Partial<{
      status: LoopStatus;
      labels: unknown;
      nextRunAt: string | null;
      retryScheduledFor: string | null;
      expiresAt: string | null;
      expiresAfterRuns: number | null;
      maxAttempts: unknown;
      leaseMs: unknown;
    }>;
    // Only forward keys the caller actually sent. Store.updateLoop merges
    // {...current, ...patch}, so a present-but-undefined key overrides the
    // current value: emitting all four keys unconditionally wiped omitted
    // schedule fields (and set status=NULL -> NOT NULL 500). A key set to
    // JSON null is an explicit clear (mapped to undefined -> merged to null).
    const patch: Partial<{ status: LoopStatus; labels: string[]; nextRunAt: string; retryScheduledFor: string; expiresAt: string; expiresAfterRuns: number; maxAttempts: number; leaseMs: number }> = {};
    if ("status" in body) {
      if (!isLoopStatus(body.status)) throw apiError("invalid_loop_status", 422);
      patch.status = body.status;
    }
    if ("maxAttempts" in body) {
      if (!isMaxAttempts(body.maxAttempts)) throw apiError("invalid_max_attempts", 422);
      patch.maxAttempts = body.maxAttempts;
    }
    if ("leaseMs" in body) {
      if (!isLeaseMs(body.leaseMs)) throw apiError("invalid_lease_ms", 422);
      patch.leaseMs = body.leaseMs;
    }
    if ("expiresAfterRuns" in body) {
      if (body.expiresAfterRuns !== null && !isExpiresAfterRuns(body.expiresAfterRuns)) {
        throw apiError("invalid_expires_after_runs", 422);
      }
      patch.expiresAfterRuns = body.expiresAfterRuns === null ? undefined : body.expiresAfterRuns;
    }
    if ("labels" in body) patch.labels = normalizedLabels(body.labels);
    if ("nextRunAt" in body) patch.nextRunAt = body.nextRunAt === null ? undefined : body.nextRunAt;
    if ("retryScheduledFor" in body) patch.retryScheduledFor = body.retryScheduledFor === null ? undefined : body.retryScheduledFor;
    if ("expiresAt" in body) patch.expiresAt = body.expiresAt === null ? undefined : body.expiresAt;
    const loop = await storage.updateLoop(id, patch);
    return ok({ loop: publicLoop(loop) });
  }
  if (segments.length === 1 && ctx.request.method === "DELETE") {
    return ok({ deleted: await storage.deleteLoop(id) });
  }
  if (segments.length === 2 && segments[1] === "archive" && ctx.request.method === "POST") {
    return ok({ loop: publicLoop(await storage.archiveLoop(id)) });
  }
  if (segments.length === 2 && segments[1] === "unarchive" && ctx.request.method === "POST") {
    return ok({ loop: publicLoop(await storage.unarchiveLoop(id)) });
  }
  if (segments.length === 2 && segments[1] === "rename" && ctx.request.method === "POST") {
    const body = await readJsonBody<{ name?: unknown }>(ctx.request, ctx.bodyLimitBytes);
    const name = requiredString(body.name, "name");
    return ok({ loop: publicLoop(await storage.renameLoop(id, name)) });
  }
  if (segments.length === 2 && segments[1] === "run-now" && ctx.request.method === "POST") {
    // Hosted run-now: schedule the loop due at the control-plane's current time
    // so a bound loops-runner claims and executes it on its next poll (the same
    // schedule-mode semantics the local MCP run-now uses for daemon pickup).
    // The client never executes the loop target while connected to the API, so
    // there is nothing to run inline here — only the schedule mutation.
    const loop = await storage.requireUniqueLoop(id);
    if (loop.archivedAt) throw new LoopArchivedError(loop.name || id);
    const scheduledFor = ctx.now().toISOString();
    const updated = await storage.updateLoop(loop.id, { status: "active", nextRunAt: scheduledFor });
    return ok({ loop: publicLoop(updated), scheduledFor });
  }
  if (segments.length === 2 && segments[1] === "mutations" && ctx.request.method === "POST") {
    const body = await readJsonBody<LoopMutationEnvelope>(ctx.request, ctx.bodyLimitBytes);
    if (body.targetId !== id) throw apiError("loop_mutation_target_mismatch", 422);
    const mutation = await storage.mutateLoop(body, {
      authorityId: "loops-control-plane",
      tenantId: ctx.auth.tenantId,
    }, { now: ctx.now() });
    const publicMutation = publicLoopMutationResult(mutation);
    return ok({
      mutation: {
        binding: publicMutation.binding,
        admission: publicMutation.admission,
        terminal: publicMutation.terminal,
        loop: publicLoop(mutation.loop),
        replayed: mutation.replayed,
      },
    });
  }
  const bundleResponse = await handleLoopBundleRequest(bundleContext(ctx), id, segments.slice(1));
  if (bundleResponse) return bundleResponse;
  return fail("not_found", 404);
}

/**
 * The bundle routes take a narrower context than the rest of `/v1` — they never
 * touch the evidence/import limits — and carry their own body budget, because a
 * 2 MiB archive must not pass through `readJsonBody`'s 64 KiB ceiling.
 */
function bundleContext(ctx: V1RequestContext) {
  return {
    request: ctx.request,
    url: ctx.url,
    storage: ctx.storage,
    auth: ctx.auth,
    bodyLimitBytes: ctx.bodyLimitBytes,
    bundleLimitBytes: ctx.bundleLimitBytes ?? DEFAULT_BUNDLE_LIMIT_BYTES,
    now: ctx.now,
    artifacts: ctx.artifacts,
  };
}

async function handleLoopMutationsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  if (ctx.request.method !== "GET" || segments.length !== 2) return fail("not_found", 404);
  const [operationId, stepId] = segments;
  if (!operationId || !stepId) return fail("not_found", 404);
  const mutation = await requireStorage(ctx.storage).getLoopMutationResult(
    { authorityId: "loops-control-plane", tenantId: ctx.auth.tenantId },
    operationId,
    stepId,
    {
      maxCalls: optionalPositiveInteger(ctx.url.searchParams.get("maxCalls"), 1, 8) ?? 2,
      maxRecords: optionalPositiveInteger(ctx.url.searchParams.get("maxRecords"), 1, 2) ?? 2,
      maxBytes: optionalPositiveInteger(ctx.url.searchParams.get("maxBytes"), 1, 1024 * 1024) ?? 64 * 1024,
      maxWallMs: optionalPositiveInteger(ctx.url.searchParams.get("maxWallMs"), 1, 5_000) ?? 250,
    },
  );
  if (!mutation) return fail("loop_mutation_not_found", 404);
  const publicMutation = publicLoopMutationResult(mutation);
  return ok({
    mutation: {
      binding: publicMutation.binding,
      admission: publicMutation.admission,
      terminal: publicMutation.terminal,
      loop: publicLoop(mutation.loop),
      replayed: true,
    },
  });
}

async function handleWorkflowsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  if (segments.length === 0 && ctx.request.method === "GET") {
    const workflows = await storage.listWorkflows({
      status: optionalEnum<WorkflowSpec["status"]>(ctx.url.searchParams.get("status"), ["active", "archived"]),
      limit: optionalLimit(ctx.url.searchParams.get("limit")),
      offset: optionalOffset(ctx.url.searchParams.get("offset")),
    });
    return ok({ workflows: workflows.map(publicWorkflow) });
  }
  if (segments.length === 0 && ctx.request.method === "POST") {
    const body = await readJsonBody<CreateWorkflowInput>(ctx.request, ctx.bodyLimitBytes);
    return ok({ workflow: publicWorkflow(await storage.createWorkflow(body)) }, { status: 201 });
  }
  if (segments.length === 1 && segments[0] === "count" && ctx.request.method === "GET") {
    const count = await storage.countWorkflows({
      status: optionalEnum<WorkflowSpec["status"]>(ctx.url.searchParams.get("status"), ["active", "archived"]),
    });
    return ok({ count });
  }
  const id = segments[0];
  if (!id) return fail("not_found", 404);
  if (segments.length === 1 && ctx.request.method === "GET") {
    const workflow = await storage.getWorkflow(id);
    if (!workflow) return fail("workflow_not_found", 404);
    return ok({ workflow: publicWorkflow(workflow) });
  }
  if (segments.length === 2 && segments[1] === "archive" && ctx.request.method === "POST") {
    return ok({ workflow: publicWorkflow(await storage.archiveWorkflow(id)) });
  }
  return fail("not_found", 404);
}

async function handleWorkflowRunsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  if (segments.length === 0 && ctx.request.method === "GET") {
    const runs = await storage.listWorkflowRuns({
      workflowId: ctx.url.searchParams.get("workflowId") ?? undefined,
      loopRunId: ctx.url.searchParams.get("loopRunId") ?? undefined,
      limit: optionalLimit(ctx.url.searchParams.get("limit")),
    });
    return ok({ workflowRuns: runs.map(publicWorkflowRun) });
  }
  const id = segments[0];
  if (!id) return fail("not_found", 404);
  if (segments.length === 1 && ctx.request.method === "GET") {
    const run = await storage.getWorkflowRun(id);
    if (!run) return fail("workflow_run_not_found", 404);
    return ok({ workflowRun: publicWorkflowRun(run) });
  }
  if (segments.length === 2 && segments[1] === "recover" && ctx.request.method === "POST") {
    const run = await storage.getWorkflowRun(id);
    if (!run) return fail("workflow_run_not_found", 404);
    const body = await readWorkflowRecoveryBody(ctx.request, ctx.bodyLimitBytes);
    const recovered = await storage.recoverWorkflowRun(id, body.reason, {
      mode: "operator",
      now: ctx.now(),
    });
    return ok({
      workflowRun: publicWorkflowRun(recovered.run),
      recoveredSteps: recovered.recoveredSteps.map((step) => publicWorkflowStepRun(step)),
    });
  }
  if (segments.length === 2 && segments[1] === "steps" && ctx.request.method === "GET") {
    const steps = await storage.listWorkflowStepRuns(id);
    return ok({ steps: steps.map((step) => publicWorkflowStepRun(step)) });
  }
  if (segments.length === 2 && segments[1] === "events" && ctx.request.method === "GET") {
    const events = await storage.listWorkflowEvents(id, optionalLimit(ctx.url.searchParams.get("limit")) ?? 200);
    return ok({
      events: events
        .filter((event) => !isPrivateOperationEventType(event.eventType))
        .map(publicWorkflowEvent),
    });
  }
  return fail("not_found", 404);
}

async function handleWorkItemsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  if (segments.length === 0 && ctx.request.method === "GET") {
    const items = await storage.listWorkflowWorkItems({
      status: optionalString(ctx.url.searchParams.get("status")) as WorkflowWorkItemStatus | undefined,
      routeKey: ctx.url.searchParams.get("routeKey") ?? undefined,
      limit: optionalLimit(ctx.url.searchParams.get("limit")),
    });
    return ok({ workItems: items.map(publicWorkflowWorkItem) });
  }
  if (segments.length === 0 && ctx.request.method === "POST") {
    const body = await readJsonBody<UpsertWorkflowWorkItemInput>(ctx.request, ctx.bodyLimitBytes);
    return ok({ workItem: publicWorkflowWorkItem(await storage.upsertWorkflowWorkItem(body)) }, { status: 201 });
  }
  const id = segments[0];
  if (!id) return fail("not_found", 404);
  if (segments.length === 1 && ctx.request.method === "GET") {
    const item = await storage.getWorkflowWorkItem(id);
    if (!item) return fail("work_item_not_found", 404);
    return ok({ workItem: publicWorkflowWorkItem(item) });
  }
  return fail("not_found", 404);
}

async function handleInvocationsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  if (segments.length === 0 && ctx.request.method === "GET") {
    const invocations = await storage.listWorkflowInvocations({ limit: optionalLimit(ctx.url.searchParams.get("limit")) });
    return ok({ invocations: invocations.map(publicWorkflowInvocation) });
  }
  if (segments.length === 0 && ctx.request.method === "POST") {
    const body = await readJsonBody<CreateWorkflowInvocationInput>(ctx.request, ctx.bodyLimitBytes);
    return ok({ invocation: publicWorkflowInvocation(await storage.createWorkflowInvocation(body)) }, { status: 201 });
  }
  const id = segments[0];
  if (!id) return fail("not_found", 404);
  if (segments.length === 1 && ctx.request.method === "GET") {
    const invocation = await storage.getWorkflowInvocation(id);
    if (!invocation) return fail("invocation_not_found", 404);
    return ok({ invocation: publicWorkflowInvocation(invocation) });
  }
  return fail("not_found", 404);
}

async function handleGoalsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  if (segments.length === 0 && ctx.request.method === "GET") {
    const goals = await storage.listGoals({
      status: optionalString(ctx.url.searchParams.get("status")) as GoalStatus | undefined,
      limit: optionalLimit(ctx.url.searchParams.get("limit")),
    });
    return ok({ goals: goals.map(publicGoal) });
  }
  const id = segments[0];
  if (!id) return fail("not_found", 404);
  if (segments.length === 1 && ctx.request.method === "GET") {
    const goal = await storage.getGoal(id);
    if (!goal) return fail("goal_not_found", 404);
    return ok({ goal: publicGoal(goal) });
  }
  if (segments.length === 2 && segments[1] === "plan-nodes" && ctx.request.method === "GET") {
    const nodes = await storage.listGoalPlanNodes(id);
    return ok({ nodes });
  }
  return fail("not_found", 404);
}

async function handleGoalRunsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  if (segments.length === 0 && ctx.request.method === "GET") {
    const runs = await storage.listGoalRuns({
      goalId: ctx.url.searchParams.get("goalId") ?? undefined,
      runId: ctx.url.searchParams.get("runId") ?? undefined,
      limit: optionalLimit(ctx.url.searchParams.get("limit")),
    });
    return ok({ goalRuns: runs.map(publicGoalRun) });
  }
  return fail("not_found", 404);
}

async function handleHistoryRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  if (segments.length === 1 && segments[0] === "prune" && ctx.request.method === "POST") {
    const body = await readJsonBody<{ maxAgeDays?: unknown; keepPerLoop?: unknown; dryRun?: unknown }>(ctx.request, ctx.bodyLimitBytes);
    const history = await storage.pruneHistory({
      maxAgeDays: optionalInteger(body.maxAgeDays),
      keepPerLoop: optionalInteger(body.keepPerLoop),
      dryRun: body.dryRun === undefined ? undefined : Boolean(body.dryRun),
    });
    return ok({ history });
  }
  return fail("not_found", 404);
}

async function handleRunsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const id = segments[0];
  if (id && segments[1] === "workflow-runs") {
    return await handleRunWorkflowExecutionRequest(ctx, id, segments.slice(2));
  }
  if (id && segments[1] === "goals") {
    return await handleRunGoalExecutionRequest(ctx, id, segments.slice(2));
  }
  if (segments.length === 2 && id && ["heartbeat", "finalize", "evidence"].includes(segments[1] ?? "") && ctx.request.method === "POST") {
    const storage = requireStorage(ctx.storage);
    const action = segments[1];
    const now = ctx.now();
    if (action === "heartbeat") return heartbeatRun(storage, ctx.auth.principalId, id, await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes), now);
    if (action === "finalize") {
      return finalizeRun(
        storage,
        ctx.auth.principalId,
        id,
        await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes),
        now,
        {
          random: ctx.random,
          circuitBreakerThreshold: ctx.circuitBreakerThreshold,
        },
      );
    }
    return acceptRunEvidence(storage, ctx.auth.principalId, id, await readJsonBody<Record<string, unknown>>(ctx.request, ctx.evidenceLimitBytes), now);
  }
  if (segments.length === 2 && id && segments[1] === "recover" && ctx.request.method === "POST") {
    const storage = requireStorage(ctx.storage);
    const now = ctx.now();
    const target = await storage.getRun(id);
    if (!target) return fail("run_not_found", 404);
    if ((ctx.auth.tokenKind === "machine" || ctx.auth.roles.includes("worker")) && target.claimedBy !== ctx.auth.principalId) {
      return fail("run_claim_owner_mismatch", 403);
    }
    const recovered = await storage.recoverExpiredRunLeasesDetailed(now, {
      runId: id,
      limit: 1,
      scanLimit: 1,
      refuseAdmittedPrivateOperations: true,
    });
    const abandoned = recovered.abandoned.length > 0
      ? recovered.abandoned
      : isRecoveredLeaseRun(target)
        ? [target]
        : [];
    const deferred = recovered.deferred;
    const advancementDeferred = await advanceRecoveredRuns(storage, abandoned, {
      random: ctx.random,
      circuitBreakerThreshold: ctx.circuitBreakerThreshold,
    });
    return ok({
      abandoned: abandoned.map((run) => publicRun(run, false, { redactError: true })),
      deferred: deferred.map((run) => publicRun(run, false, { redactError: true })),
      advancementDeferred: advancementDeferred.map((run) => publicRun(run, false, { redactError: true })),
      reconciliation: { outcomes: operationReconciliationOutcomes(recovered.operationReconciliationRequired) },
    });
  }

  const storage = requireStorage(ctx.storage);
  const showOutput = optionalBoolean(ctx.url.searchParams.get("showOutput")) ?? false;
  // GET /v1/runs/count — total-row verification (run history is far larger than
  // the 1000-row list cap). Accepts the SAME loopId/labels/status filters as
  // GET /v1/runs so the count reflects the filtered population (LOO3-00143 P1).
  if (segments.length === 1 && id === "count" && ctx.request.method === "GET") {
    const count = await storage.countRuns({
      loopId: ctx.url.searchParams.get("loopId") ?? undefined,
      status: optionalEnum<RunStatus>(ctx.url.searchParams.get("status"), ["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"]),
      labels: labelsFromSearchParams(ctx.url.searchParams),
    });
    return ok({ count });
  }
  if (segments.length === 0 && ctx.request.method === "GET") {
    const runs = await storage.listRuns({
      loopId: ctx.url.searchParams.get("loopId") ?? undefined,
      status: optionalEnum<RunStatus>(ctx.url.searchParams.get("status"), ["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"]),
      labels: labelsFromSearchParams(ctx.url.searchParams),
      limit: optionalLimit(ctx.url.searchParams.get("limit")),
      offset: optionalOffset(ctx.url.searchParams.get("offset")),
    });
    return ok({ runs: runs.map((run) => publicRun(run, showOutput, { redactError: true })) });
  }
  if (!id) return fail("not_found", 404);
  if (segments.length === 1 && ctx.request.method === "GET") {
    const run = await storage.getRun(id);
    if (!run) return fail("run_not_found", 404);
    return ok({ run: publicRun(run, showOutput, { redactError: true }) });
  }
  return fail("not_found", 404);
}

async function authorizeRunnerClaim(
  storage: LoopStorageContract,
  principalId: string,
  runId: string,
  claimToken: string,
  now: Date,
): Promise<{ ok: true; run: LoopRun; loop: Loop } | { ok: false; response: Response }> {
  const run = await storage.getRun(runId);
  if (!run) return { ok: false, response: fail("run_not_found", 404) };
  if (run.status !== "running" || !run.claimedBy) return { ok: false, response: fail("run_not_running", 409) };
  if (run.claimedBy !== principalId) return { ok: false, response: fail("runner_identity_mismatch", 403) };
  const loop = await storage.getLoop(run.loopId);
  if (!loop) return { ok: false, response: fail("loop_not_found", 404) };
  const heartbeat = await storage.heartbeatRunLease(
    run.id,
    run.claimedBy,
    runnerLeaseMs(loop.leaseMs),
    now,
    { claimToken },
  );
  if (!heartbeat) return { ok: false, response: fail("stale_claim", 409) };
  return { ok: true, run: heartbeat, loop };
}

async function requireClaimedWorkflowRun(
  storage: LoopStorageContract,
  workflowRunId: string,
  runId: string,
): Promise<{ ok: true; workflowRun: Awaited<ReturnType<LoopStorageContract["getWorkflowRun"]>> & {} } | { ok: false; response: Response }> {
  const workflowRun = await storage.getWorkflowRun(workflowRunId);
  if (!workflowRun) return { ok: false, response: fail("workflow_run_not_found", 404) };
  if (workflowRun.loopRunId !== runId) return { ok: false, response: fail("workflow_run_claim_mismatch", 403) };
  return { ok: true, workflowRun };
}

function contractPayload(contract: AgentSessionContract): Record<string, unknown> {
  return JSON.parse(JSON.stringify(contract)) as Record<string, unknown>;
}

function deriveWorkflowStepAgentSessionContract(step: WorkflowStep): AgentSessionContract | undefined {
  try {
    return workflowStepAgentSessionContract(step);
  } catch {
    // Stored workflows created before this contract existed are untrusted input.
    // Do not leak their target details; require an explicit workflow rewrite.
    throw apiError("stored_workflow_agent_contract_invalid", 409);
  }
}

function validateStoredWorkflowAgentContracts(workflow: WorkflowSpec): void {
  for (const step of workflow.steps) {
    if (step.target.type === "agent") deriveWorkflowStepAgentSessionContract(step);
  }
}

const WORKFLOW_EVENT_SCAN_LIMIT = DEFAULT_OPERATION_LOOKUP_CAPS.maxRecords + 1;

function privateOperationDescriptors(
  events: StoredWorkflowEvent[],
  tenantId: string,
): PrivateOperationDescriptor[] {
  if (events.length > DEFAULT_OPERATION_LOOKUP_CAPS.maxRecords) {
    throw apiError("private_operation_lookup_cap_exceeded", 409);
  }
  const descriptors = events
    .filter((event) => event.eventType === "private_operation_descriptor")
    .map((event) => parsePrivateOperationDescriptor(event.payload));
  const stepIds = new Set<string>();
  for (const descriptor of descriptors) {
    if (
      descriptor.authority.authorityId !== "loops-control-plane" ||
      descriptor.authority.tenantId !== tenantId
    ) {
      throw apiError("private_operation_authority_mismatch", 409);
    }
    if (stepIds.has(descriptor.stepId)) throw apiError("private_operation_descriptor_duplicate", 409);
    stepIds.add(descriptor.stepId);
  }
  return descriptors;
}

function validateExistingAgentSessionContractEvents(
  workflow: WorkflowSpec,
  events: StoredWorkflowEvent[],
  permittedMissingStepId?: string,
) {
  const contractEvents = events.filter((event) => event.eventType === "agent_session_contract");
  const workflowStepIds = new Set(workflow.steps.map((step) => step.id));
  if (contractEvents.some((event) => !event.stepId || !workflowStepIds.has(event.stepId))) {
    throw apiError("agent_session_contract_fabricated", 409);
  }
  for (const step of workflow.steps) {
    const existing = contractEvents.filter((event) => event.stepId === step.id);
    if (step.target.type !== "agent") {
      if (existing.length > 0) throw apiError("agent_session_contract_non_agent_step", 409);
      continue;
    }
    const expected = deriveWorkflowStepAgentSessionContract(step);
    if (!expected) {
      if (existing.length > 0) throw apiError("agent_session_contract_fabricated", 409);
      continue;
    }
    if (existing.length === 0) {
      if (step.id === permittedMissingStepId) continue;
      throw apiError("agent_session_contract_missing", 409);
    }
    if (existing.length > 1) throw apiError("agent_session_contract_duplicate", 409);
    if (!isDeepStrictEqual(existing[0]!.payload, contractPayload(expected))) {
      throw apiError("agent_session_contract_stored_mismatch", 409);
    }
  }
  return contractEvents;
}

async function handleRunWorkflowExecutionRequest(ctx: V1RequestContext, runId: string, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  if (ctx.request.method === "POST" && segments.length === 0) {
    const body = await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes);
    const claimToken = requiredString(body.claimToken, "claimToken");
    const authorized = await authorizeRunnerClaim(storage, ctx.auth.principalId, runId, claimToken, ctx.now());
    if (!authorized.ok) return authorized.response;
    if (authorized.loop.target.type !== "workflow") return fail("loop_not_workflow", 409);
    const workflow = await storage.getWorkflow(authorized.loop.target.workflowId);
    if (!workflow) return fail("workflow_not_found", 404);
    validateStoredWorkflowAgentContracts(workflow);
    const idempotencyKey = optionalString(body.idempotencyKey);
    const scheduledFor = optionalIsoString(body.scheduledFor) ?? authorized.run.scheduledFor;
    const workflowRun = await storage.createWorkflowRun({
      workflow,
      loop: authorized.loop,
      loopRun: authorized.run,
      scheduledFor,
      idempotencyKey,
      operationAuthority: {
        authorityId: "loops-control-plane",
        tenantId: ctx.auth.tenantId,
      },
    });
    const workflowEvents = await storage.listWorkflowEvents(workflowRun.id, WORKFLOW_EVENT_SCAN_LIMIT);
    validateExistingAgentSessionContractEvents(
      workflow,
      workflowEvents,
    );
    const operationDescriptors = privateOperationDescriptors(workflowEvents, ctx.auth.tenantId);
    return ok({
      workflowRun,
      operationDescriptors,
      operationStates: operationDescriptors.map((descriptor) =>
        lookupOperationReceiptState(workflowEvents, {
          workflowRunId: workflowRun.id,
          stepId: descriptor.stepId,
          authority: descriptor.authority,
          operationId: descriptor.operationId,
        })
      ),
    });
  }

  const workflowRunId = segments[0];
  if (!workflowRunId) return fail("not_found", 404);

  if (ctx.request.method !== "POST") return fail("not_found", 404);
  const body = await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes);
  const claimToken = requiredString(body.claimToken, "claimToken");
  const authorized = await authorizeRunnerClaim(storage, ctx.auth.principalId, runId, claimToken, ctx.now());
  if (!authorized.ok) return authorized.response;
  const scopedRun = await requireClaimedWorkflowRun(storage, workflowRunId, runId);
  if (!scopedRun.ok) return scopedRun.response;

  if (segments.length === 2 && segments[1] === "get") return ok({ workflowRun: scopedRun.workflowRun });
  if (segments.length === 2 && segments[1] === "steps") {
    return ok({ steps: await storage.listWorkflowStepRuns(workflowRunId) });
  }
  if (segments.length === 2 && segments[1] === "recover") {
    const recovered = await storage.recoverWorkflowRun(workflowRunId, optionalText(body.reason), {
      mode: "runner",
      now: ctx.now(),
      loopRunId: runId,
      claimedBy: ctx.auth.principalId,
      claimToken,
    });
    return ok({ workflowRun: recovered.run, recoveredSteps: recovered.recoveredSteps });
  }
  if (segments.length === 2 && segments[1] === "events") {
    const eventType = requiredString(body.eventType, "eventType");
    const stepId = requiredString(body.stepId, "stepId");
    const step = await storage.getWorkflowStepRun(workflowRunId, stepId);
    if (!step) return fail("workflow_step_not_found", 404);
    const workflow = await storage.getWorkflow(scopedRun.workflowRun.workflowId);
    if (!workflow) return fail("workflow_not_found", 404);
    const workflowStep = workflow.steps.find((candidate) => candidate.id === stepId);
    if (!workflowStep) return fail("workflow_step_not_found", 404);
    if (eventType === "private_operation_admitted" || eventType === "private_operation_terminal") {
      const workflowEvents = await storage.listWorkflowEvents(workflowRunId, WORKFLOW_EVENT_SCAN_LIMIT);
      const descriptor = privateOperationDescriptors(workflowEvents, ctx.auth.tenantId)
        .find((candidate) => candidate.stepId === stepId);
      if (!descriptor) throw apiError("private_operation_descriptor_missing", 409);
      const supplied = objectRecord(body.payload);
      const expectedPayload = eventType === "private_operation_admitted"
        ? operationAdmissionReceipt(descriptor)
        : parseOperationTerminalReceipt(supplied);
      if (
        expectedPayload.operationId !== descriptor.operationId ||
        expectedPayload.workflowRunId !== descriptor.workflowRunId ||
        expectedPayload.stepId !== descriptor.stepId ||
        expectedPayload.authority.authorityId !== descriptor.authority.authorityId ||
        expectedPayload.authority.tenantId !== descriptor.authority.tenantId
      ) {
        throw apiError("private_operation_receipt_binding_mismatch", 409);
      }
      if (eventType === "private_operation_admitted" && !isDeepStrictEqual(supplied, expectedPayload)) {
        throw apiError("private_operation_admission_mismatch", 409);
      }
      const existing = workflowEvents.find((event) => event.eventType === eventType && event.stepId === stepId);
      if (existing) {
        if (!isDeepStrictEqual(existing.payload, expectedPayload)) {
          throw apiError("private_operation_receipt_conflict", 409);
        }
        return ok({ event: existing, duplicate: true });
      }
      try {
        return ok({
          event: await storage.appendWorkflowEvent(
            workflowRunId,
            eventType,
            stepId,
            expectedPayload as unknown as Record<string, unknown>,
          ),
          duplicate: false,
        });
      } catch (error) {
        if (!(error instanceof DuplicateWorkflowEventError)) throw error;
        const after = await storage.listWorkflowEvents(workflowRunId, WORKFLOW_EVENT_SCAN_LIMIT);
        const state = lookupOperationReceiptState(after, {
          workflowRunId,
          stepId,
          authority: descriptor.authority,
          operationId: descriptor.operationId,
        });
        const duplicate = eventType === "private_operation_admitted" ? state.admission : state.terminal;
        if (!isDeepStrictEqual(duplicate, expectedPayload)) {
          throw apiError("private_operation_receipt_conflict", 409);
        }
        return ok({ event: duplicate, duplicate: true });
      }
    }
    if (eventType !== "agent_session_contract") throw apiError("event_type_not_allowed", 422);
    if (workflowStep.target.type !== "agent") throw apiError("agent_session_contract_non_agent_step", 422);
    const expected = deriveWorkflowStepAgentSessionContract(workflowStep);
    if (!expected) throw apiError("agent_session_contract_not_required", 422);
    const supplied = objectRecord(body.payload);
    if (!isDeepStrictEqual(supplied, contractPayload(expected))) {
      throw apiError("agent_session_contract_mismatch", 409);
    }
    const existingContracts = validateExistingAgentSessionContractEvents(
      workflow,
      await storage.listWorkflowEvents(workflowRunId, WORKFLOW_EVENT_SCAN_LIMIT),
      stepId,
    );
    const duplicates = existingContracts.filter((event) =>
      event.eventType === "agent_session_contract" && event.stepId === stepId
    );
    if (duplicates.length > 0) throw apiError("agent_session_contract_duplicate", 409);
    try {
      return ok({
        event: await storage.appendWorkflowEvent(
          workflowRunId,
          eventType,
          stepId,
          contractPayload(expected),
        ),
      });
    } catch (error) {
      if (error instanceof DuplicateWorkflowEventError) {
        throw apiError("agent_session_contract_duplicate", 409);
      }
      throw error;
    }
  }
  if (segments.length === 2 && segments[1] === "finalize") {
    const status = optionalEnum<WorkflowRunStatus>(
      optionalString(body.status) ?? null,
      ["running", "succeeded", "failed", "timed_out", "cancelled"],
    );
    if (!status || status === "running") throw apiError("status_required", 422);
    const workflowRun = await storage.finalizeWorkflowRun(workflowRunId, status, {
      finishedAt: optionalIsoString(body.finishedAt),
      durationMs: optionalPositiveInteger(body.durationMs, 0, Number.MAX_SAFE_INTEGER),
      error: optionalText(body.error),
    });
    return ok({ workflowRun });
  }

  if (segments[1] !== "steps") return fail("not_found", 404);
  const stepId = segments[2];
  if (!stepId) return fail("not_found", 404);
  const action = segments[3];
  if (!action) return fail("not_found", 404);
  if (action === "get") {
    const step = await storage.getWorkflowStepRun(workflowRunId, stepId);
    if (!step) return fail("workflow_step_not_found", 404);
    return ok({ step });
  }
  if (action === "start") {
    return ok({ step: await storage.startWorkflowStepRun(workflowRunId, stepId) });
  }
  if (action === "pid") {
    const pid = optionalInteger(body.pid);
    if (pid === undefined) throw apiError("pid_required", 422);
    return ok({ step: await storage.markWorkflowStepPid(workflowRunId, stepId, pid) });
  }
  if (action === "progress") {
    return ok({
      step: await storage.recordWorkflowStepProgress(workflowRunId, stepId, {
        stdout: optionalText(body.stdout),
        stderr: optionalText(body.stderr),
        payload: objectRecord(body.payload),
      }),
    });
  }
  if (action === "skip") {
    return ok({ step: await storage.skipWorkflowStepRun(workflowRunId, stepId, requiredString(body.reason, "reason")) });
  }
  if (action === "finalize") {
    const status = optionalEnum<WorkflowStepRunStatus>(
      optionalString(body.status) ?? null,
      ["pending", "running", "succeeded", "failed", "timed_out", "skipped", "cancelled"],
    );
    if (!status || status === "pending" || status === "running") throw apiError("status_required", 422);
    return ok({
      step: await storage.finalizeWorkflowStepRun(workflowRunId, stepId, {
        status,
        finishedAt: optionalIsoString(body.finishedAt) ?? new Date().toISOString(),
        durationMs: optionalPositiveInteger(body.durationMs, 0, Number.MAX_SAFE_INTEGER) ?? 0,
        stdout: optionalText(body.stdout) ?? "",
        stderr: optionalText(body.stderr) ?? "",
        exitCode: optionalInteger(body.exitCode),
        error: optionalText(body.error),
      }),
    });
  }
  return fail("not_found", 404);
}

async function requireClaimedGoal(
  storage: LoopStorageContract,
  goalId: string,
  runId: string,
): Promise<{ ok: true; goal: Awaited<ReturnType<LoopStorageContract["getGoal"]>> & {} } | { ok: false; response: Response }> {
  const goal = await storage.getGoal(goalId);
  if (!goal) return { ok: false, response: fail("goal_not_found", 404) };
  if (goal.loopRunId === runId) return { ok: true, goal };
  if (goal.workflowRunId) {
    const scopedRun = await requireClaimedWorkflowRun(storage, goal.workflowRunId, runId);
    if (scopedRun.ok) return { ok: true, goal };
  }
  return { ok: false, response: fail("goal_claim_mismatch", 403) };
}

async function scopeRunnerGoalInput(
  storage: LoopStorageContract,
  authorized: { run: LoopRun; loop: Loop },
  input: RunnerGoalInput,
): Promise<{ ok: true; input: RunnerGoalInput } | { ok: false; response: Response }> {
  const scoped: RunnerGoalInput = {
    objective: input.objective,
    tokenBudget: input.tokenBudget,
    autoExecute: input.autoExecute,
    maxTokens: input.maxTokens,
    loopId: authorized.loop.id,
    loopRunId: authorized.run.id,
    workflowId: input.workflowId,
    workflowRunId: input.workflowRunId,
    workflowStepId: input.workflowStepId,
  };
  if (scoped.workflowRunId) {
    const scopedRun = await requireClaimedWorkflowRun(storage, scoped.workflowRunId, authorized.run.id);
    if (!scopedRun.ok) return scopedRun;
    scoped.workflowId = scopedRun.workflowRun.workflowId;
  } else if (scoped.workflowId && authorized.loop.target.type === "workflow" && scoped.workflowId !== authorized.loop.target.workflowId) {
    return { ok: false, response: fail("workflow_claim_mismatch", 403) };
  }
  return { ok: true, input: scoped };
}

async function scopeRunnerGoalContext(
  storage: LoopStorageContract,
  runId: string,
  context: Record<string, unknown>,
): Promise<{
  ok: true;
  context: {
    loopRunId?: string;
    workflowRunId?: string;
    workflowStepId?: string;
  };
} | { ok: false; response: Response }> {
  const scoped = {
    loopRunId: optionalString(context.loopRunId),
    workflowRunId: optionalString(context.workflowRunId),
    workflowStepId: optionalString(context.workflowStepId),
  };
  if (scoped.loopRunId && scoped.loopRunId !== runId) return { ok: false, response: fail("goal_context_claim_mismatch", 403) };
  if (scoped.workflowRunId) {
    const scopedRun = await requireClaimedWorkflowRun(storage, scoped.workflowRunId, runId);
    if (!scopedRun.ok) return scopedRun;
  }
  scoped.loopRunId ??= runId;
  return { ok: true, context: scoped };
}

function createGoalInputFromBody(value: unknown): RunnerGoalInput {
  const input = objectRecord(value);
  return {
    objective: requiredString(input.objective, "objective"),
    tokenBudget: optionalPositiveInteger(input.tokenBudget, 1, Number.MAX_SAFE_INTEGER),
    autoExecute: optionalEnum(optionalString(input.autoExecute) ?? null, ["off", "readyOnly", "aiDirected"]),
    maxTokens: optionalPositiveInteger(input.maxTokens, 1, Number.MAX_SAFE_INTEGER),
    loopId: optionalString(input.loopId),
    loopRunId: optionalString(input.loopRunId),
    workflowId: optionalString(input.workflowId),
    workflowRunId: optionalString(input.workflowRunId),
    workflowStepId: optionalString(input.workflowStepId),
  };
}

function goalPlanNodesFromBody(value: unknown): RunnerGoalPlanNodeInput[] {
  if (!Array.isArray(value)) throw apiError("nodes_required", 422);
  return value.map((entry) => {
    const node = objectRecord(entry);
    const dependsOn = node.dependsOn === undefined
      ? undefined
      : Array.isArray(node.dependsOn) ? node.dependsOn.map((dependency) => requiredString(dependency, "dependsOn")) : undefined;
    if (node.dependsOn !== undefined && !dependsOn) throw apiError("invalid_dependsOn", 422);
    return {
      key: requiredString(node.key, "key"),
      objective: requiredString(node.objective, "objective"),
      dependsOn,
      priority: optionalInteger(node.priority),
      tokenBudget: optionalPositiveInteger(node.tokenBudget, 1, Number.MAX_SAFE_INTEGER),
    };
  });
}

const GOAL_RUN_STATUSES = ["pending", "active", "paused", "blocked", "usageLimited", "budgetLimited", "complete", "cancelled"] as const;

function goalEventFromBody(goalId: string, value: unknown): RunnerGoalEventInput {
  const input = objectRecord(value);
  const phase = optionalEnum(optionalString(input.phase) ?? null, ["plan", "execute", "validate", "status"]);
  const status = optionalEnum(optionalString(input.status) ?? null, GOAL_RUN_STATUSES);
  if (!phase) throw apiError("phase_required", 422);
  if (!status) throw apiError("status_required", 422);
  return {
    goalId,
    turn: optionalPositiveInteger(input.turn, 0, Number.MAX_SAFE_INTEGER),
    phase,
    status,
    nodeKey: optionalString(input.nodeKey),
    tokensUsed: optionalPositiveInteger(input.tokensUsed, 0, Number.MAX_SAFE_INTEGER),
    evidence: input.evidence === undefined ? undefined : objectRecord(input.evidence),
    rawResponse: input.rawResponse,
  };
}

async function handleRunGoalExecutionRequest(ctx: V1RequestContext, runId: string, segments: string[]): Promise<Response> {
  if (ctx.request.method !== "POST") return fail("not_found", 404);
  const storage = requireStorage(ctx.storage);
  const body = await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes);
  const claimToken = requiredString(body.claimToken, "claimToken");
  const authorized = await authorizeRunnerClaim(storage, ctx.auth.principalId, runId, claimToken, ctx.now());
  if (!authorized.ok) return authorized.response;

  if (segments.length === 1 && segments[0] === "find") {
    const context = await scopeRunnerGoalContext(storage, runId, objectRecord(body.context));
    if (!context.ok) return context.response;
    return ok({ goal: await storage.findGoalByContext(context.context) });
  }
  if (segments.length === 0) {
    const scoped = await scopeRunnerGoalInput(storage, authorized, createGoalInputFromBody(body.input ?? body.goal ?? body));
    if (!scoped.ok) return scoped.response;
    return ok({ goal: await storage.createGoal(scoped.input) });
  }

  const goalId = segments[0];
  if (!goalId) return fail("not_found", 404);
  const scopedGoal = await requireClaimedGoal(storage, goalId, runId);
  if (!scopedGoal.ok) return scopedGoal.response;

  if (segments.length === 2 && segments[1] === "get") return ok({ goal: scopedGoal.goal });
  if (segments.length === 2 && segments[1] === "status") {
    const status = optionalEnum<GoalStatus>(
      optionalString(body.status) ?? null,
      ["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete", "cancelled"],
    );
    if (!status) throw apiError("status_required", 422);
    return ok({ goal: await storage.updateGoalStatus(goalId, status) });
  }
  if (segments.length === 2 && segments[1] === "events") {
    return ok({ goalRun: await storage.recordGoalEvent(goalEventFromBody(goalId, body.input ?? body.event ?? body)) });
  }
  if (segments.length === 2 && segments[1] === "plan-nodes") {
    return ok({ nodes: await storage.createGoalPlanNodes(goalId, goalPlanNodesFromBody(body.nodes)) });
  }
  if (segments.length === 3 && segments[1] === "plan-nodes" && segments[2] === "list") {
    return ok({ nodes: await storage.listGoalPlanNodes(goalId) });
  }
  if (segments.length === 3 && segments[1] === "plan-nodes") {
    const key = segments[2]!;
    const status = optionalEnum(optionalString(body.status) ?? null, GOAL_RUN_STATUSES);
    const ready = body.ready === undefined
      ? undefined
      : typeof body.ready === "boolean" ? body.ready : (() => { throw apiError("invalid_boolean", 422); })();
    return ok({
      node: await storage.updateGoalPlanNode(goalId, key, {
        status,
        tokensUsed: optionalPositiveInteger(body.tokensUsed, 0, Number.MAX_SAFE_INTEGER),
        timeUsedSeconds: optionalPositiveInteger(body.timeUsedSeconds, 0, Number.MAX_SAFE_INTEGER),
        ready,
      }),
    });
  }

  return fail("not_found", 404);
}

async function handleReceiptsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  const id = segments[0];
  if (segments.length === 0 && ctx.request.method === "GET") {
    const receipts = await storage.listRunReceipts({
      loopId: ctx.url.searchParams.get("loopId") ?? undefined,
      repo: ctx.url.searchParams.get("repo") ?? undefined,
      taskId: ctx.url.searchParams.get("taskId") ?? undefined,
      knowledgeId: ctx.url.searchParams.get("knowledgeId") ?? undefined,
      status: ctx.url.searchParams.get("status") ?? undefined,
      limit: optionalLimit(ctx.url.searchParams.get("limit")),
    });
    return ok({ receipts: receipts.map(publicRunReceipt) });
  }
  if (segments.length === 0 && ctx.request.method === "POST") {
    const body = await readJsonBody<WriteRunReceiptInput>(ctx.request, ctx.evidenceLimitBytes);
    return ok({ receipt: publicRunReceipt(await storage.writeRunReceipt(body)) }, { status: 201 });
  }
  if (!id) return fail("not_found", 404);
  if (segments.length === 1 && ctx.request.method === "GET") {
    const receipt = await storage.getRunReceipt(id);
    if (!receipt) return fail("run_receipt_not_found", 404);
    return ok({ receipt: publicRunReceipt(receipt) });
  }
  return fail("not_found", 404);
}

async function handleRunnerRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  if (ctx.request.method !== "POST") return fail("not_found", 404);
  if (segments.length !== 1) return fail("not_found", 404);
  const action = segments[0];
  if (action === "poll" || action === "claim") {
    const storage = requireStorage(ctx.storage);
    const body = await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes);
    const runner = runnerRecord(body);
    requireBoundRunner(ctx.auth, runner);
    const claimResult = await claimRuns(storage, runner, {
      now: ctx.now(),
      maxClaims: optionalPositiveInteger(body.maxClaims, 1, 100) ?? 1,
      random: ctx.random,
      circuitBreakerThreshold: ctx.circuitBreakerThreshold,
    });
    return ok({ runner, ...claimResult });
  }
  return fail("not_found", 404);
}

function requireBoundRunner(auth: TenantAuthContext, runner: RunnerRecord): void {
  if (
    runner.id !== auth.principalId ||
    (runner.machineId !== undefined && runner.machineId !== auth.principalId) ||
    (runner.hostname !== undefined && runner.hostname !== auth.principalId)
  ) {
    throw apiError("runner_identity_mismatch", 403);
  }
}

const RUNNER_CLAIM_SCOPES = ["fleet", "bound"] as const;
type RunnerClaimScope = (typeof RUNNER_CLAIM_SCOPES)[number];

interface RunnerRecord {
  id: string;
  machineId?: string;
  hostname?: string;
  /**
   * `fleet` (the default, and what every runner predating this field sends)
   * claims machine-unbound loops as well as loops pinned to this runner.
   * `bound` claims only pinned loops. Absent means `fleet`.
   */
  claimScope?: RunnerClaimScope;
  labels: Record<string, string>;
  capabilities: Record<string, unknown>;
  lastSeenAt: string;
}

/**
 * An unrecognised value is a 422, never a silent fall-through to the permissive
 * default: a typo'd `--claim-scope` that answered 200 and drained the fleet
 * anyway is the precise failure this field exists to prevent.
 */
function runnerClaimScope(value: unknown): RunnerClaimScope | undefined {
  const raw = optionalString(value);
  if (raw === undefined) return undefined;
  if (!(RUNNER_CLAIM_SCOPES as readonly string[]).includes(raw)) {
    throw apiError("invalid_claim_scope", 422);
  }
  return raw as RunnerClaimScope;
}

function runnerRecord(body: Record<string, unknown>): RunnerRecord {
  const machineId = optionalString(body.machineId);
  const hostname = optionalString(body.hostname);
  const id = optionalString(body.runnerId) ?? machineId ?? hostname;
  if (!id) throw apiError("runner_id_required", 422);
  return {
    id,
    machineId,
    hostname,
    claimScope: runnerClaimScope(body.claimScope),
    labels: stringRecord(body.labels),
    capabilities: objectRecord(body.capabilities),
    lastSeenAt: new Date().toISOString(),
  };
}

async function claimRuns(
  storage: LoopStorageContract,
  runner: RunnerRecord,
  opts: {
    now: Date;
    maxClaims: number;
    random: () => number;
    circuitBreakerThreshold?: CircuitBreakerThreshold;
  },
): Promise<{
  claims: Array<Record<string, unknown>>;
  reconciliation: { outcomes: ReturnType<typeof operationReconciliationOutcomes> };
}> {
  const claims: Array<Record<string, unknown>> = [];
  const dueLoopsForPoll = await storage.dueLoops(opts.now);
  // Loops this poll never got to look at because claim capacity ran out first.
  // Their runs are the ones the sweep must not touch — see
  // `protectClaimedByInLoops` below.
  let unexaminedLoops: typeof dueLoopsForPoll = [];
  pollDueLoops:
  for (const [loopIndex, loop] of dueLoopsForPoll.entries()) {
    if (claims.length >= opts.maxClaims) {
      unexaminedLoops = dueLoopsForPoll.slice(loopIndex);
      break;
    }
    if (!runnerMatchesLoop(loop.machine, runner)) continue;
    const workflow = loop.target.type === "workflow"
      ? await storage.getWorkflow(loop.target.workflowId)
      : undefined;
    if (loop.target.type === "workflow" && !workflow) continue;
    for (const slot of dueSlots(loop, opts.now).slots) {
      if (claims.length >= opts.maxClaims) {
        // Capacity can be consumed inside one catch-up plan. In that case this
        // loop still has unexamined slots, so protect it along with every later
        // loop rather than letting the recovery sweep abandon those slots.
        unexaminedLoops = dueLoopsForPoll.slice(loopIndex);
        break pollDueLoops;
      }
      const claim = await storage.claimRun(loop, slot, runner.id, opts.now);
      if (!claim) continue;
      const run = await storage.heartbeatRunLease(
        claim.run.id,
        runner.id,
        runnerLeaseMs(claim.loop.leaseMs),
        opts.now,
        { claimToken: claim.claimToken },
      ) ?? claim.run;
      claims.push({
        loop: claim.loop,
        run: publicRun(run, false, { redactError: true }),
        claimToken: claim.claimToken,
        ...(workflow ? { workflow } : {}),
      });
      if (loop.overlap === "skip") break;
    }
  }

  // Runner polling is the hosted scheduler tick. After this runner has had a
  // chance to take over an eligible expired slot through claimRun, reap the
  // remaining expired leases in the tenant. Running the sweep after claim
  // selection preserves same-slot takeover while ensuring a run owned by a
  // missing or ineligible machine cannot remain `running` forever. Keep this
  // pass bounded to the storage recovery batch and advance only rows recovered
  // by this poll (the operator maintenance route owns historical replay).
  //
  // Protect exactly what the old `excludeClaimedBy: runner.id` was FOR: a run of
  // this runner's own that belongs to a loop this poll never examined because
  // claim capacity ran out first. Reaping one of those would pull a slot out from
  // under a runner that is about to take it over on its next poll.
  //
  // What that blanket exclusion also did, and must not, is protect a run
  // belonging to a loop this poll DID examine and could not claim. Under
  // `catchUp: "latest"` the due list holds only the newest slot, so once wall
  // time moves past a run's own slot the same-slot takeover it was being held
  // for can never happen again — and the sweep skipped it precisely because
  // this runner owned it. The one runner able to finalize the run was the one
  // runner forbidden from reaping it, so it stayed `running` with a long-dead
  // lease indefinitely and the loop's cursor advanced only if some later run
  // happened to finalize, never through recovery.
  //
  // Be precise about what that state does and does not do, because the
  // imprecise version sends the next reader to the wrong place: an expired
  // lease does NOT block `overlap: "skip"`. That gate refuses a new slot only
  // while a run holds a LIVE lease or a live process (sqlite
  // `hasBlockingRunningRunForOtherSlot`; the Postgres predicate is strictly
  // more permissive still). So what this fixes is an unreapable orphan row and
  // a recovery path that could not advance the loop — not a wedged scheduler.
  //
  // Same-slot takeover (the legitimate reason to hold a run) is unaffected: it
  // happens in the claim pass above and re-leases the run, so the sweep stops
  // selecting it at all.
  //
  // Passed as a loop-id set, never an enumerated run-id list: enumerating runs
  // costs one query per unexamined loop on the scheduler's hottest path and
  // silently truncates at one `listRuns` page.
  const recovered = await storage.recoverExpiredRunLeasesDetailed(opts.now, {
    refuseAdmittedPrivateOperations: true,
    protectClaimedByInLoops: {
      claimedBy: runner.id,
      loopIds: unexaminedLoops.map((loop) => loop.id),
    },
  });
  const advancementDeferred = await advanceRecoveredRuns(storage, recovered.abandoned, {
    random: opts.random,
    circuitBreakerThreshold: opts.circuitBreakerThreshold,
  });
  if (advancementDeferred.length > 0) {
    await advanceRecoveredRuns(storage, advancementDeferred, {
      random: opts.random,
      circuitBreakerThreshold: opts.circuitBreakerThreshold,
    });
  }

  return {
    claims,
    reconciliation: { outcomes: operationReconciliationOutcomes(recovered.operationReconciliationRequired) },
  };
}

function runnerMatchesLoop(machine: { id?: string; requestedId?: string } | undefined, runner: RunnerRecord): boolean {
  // A machine-unbound loop is claimable by any runner that has not opted out.
  // Only this branch is gated: loops pinned to a machine are matched exactly as
  // before, so narrowing a runner's scope can never widen what it claims.
  if (!machine) return runner.claimScope !== "bound";
  return machine.id === runner.id;
}

async function heartbeatRun(storage: LoopStorageContract, principalId: string, runId: string, body: Record<string, unknown>, now: Date): Promise<Response> {
  const claimToken = requiredString(body.claimToken, "claimToken");
  const run = await storage.getRun(runId);
  if (!run) return fail("run_not_found", 404);
  if (run.status !== "running" || !run.claimedBy) return fail("run_not_running", 409);
  if (run.claimedBy !== principalId) return fail("runner_identity_mismatch", 403);
  const loop = await storage.getLoop(run.loopId);
  if (!loop) return fail("loop_not_found", 404);
  const heartbeat = await storage.heartbeatRunLease(
    run.id,
    run.claimedBy,
    runnerLeaseMs(optionalPositiveInteger(body.leaseMs, 1, 24 * 60 * 60_000) ?? loop.leaseMs),
    now,
    { claimToken },
  );
  if (!heartbeat) return fail("stale_claim", 409);
  return ok({ run: publicRun(heartbeat, false, { redactError: true }) });
}

async function finalizeRun(
  storage: LoopStorageContract,
  principalId: string,
  runId: string,
  body: Record<string, unknown>,
  now: Date,
  advancement: {
    random: () => number;
    circuitBreakerThreshold?: CircuitBreakerThreshold;
  },
): Promise<Response> {
  const claimToken = requiredString(body.claimToken, "claimToken");
  const status = optionalEnum<"succeeded" | "failed" | "timed_out" | "skipped">(
    optionalString(body.status) ?? null,
    ["succeeded", "failed", "timed_out", "skipped"],
  );
  if (!status) throw apiError("status_required", 422);
  const requestedFinishedAt = optionalIsoString(body.finishedAt);
  const requestedDurationMs = optionalPositiveInteger(body.durationMs, 0, Number.MAX_SAFE_INTEGER);
  const stdout = optionalText(body.stdout) ?? "";
  const stderr = optionalText(body.stderr) ?? "";
  const error = optionalText(body.error);
  const exitCode = optionalInteger(body.exitCode);
  const pid = optionalInteger(body.pid);
  const existing = await storage.getRun(runId);
  if (!existing) return fail("run_not_found", 404);
  const loop = await storage.getLoop(existing.loopId);
  if (!loop) return fail("loop_not_found", 404);
  if (status === "skipped" && !supportsConfiguredLoopSkip(loop, exitCode)) {
    return fail("skip_status_requires_overlap_skip_exit_75", 422);
  }
  if (existing.status !== "running" || !existing.claimedBy) {
    if (
      existing.claimedBy === principalId &&
      existing.status === status &&
      ["succeeded", "failed", "timed_out", "skipped"].includes(existing.status)
    ) {
      try {
        await storage.finalizeRun(
          runId,
          {
            status,
            finishedAt: requestedFinishedAt,
            durationMs: requestedDurationMs,
            stdout,
            stderr,
            error,
            exitCode,
            pid,
          },
          { claimedBy: existing.claimedBy, claimToken, now },
        );
      } catch (replayError) {
        if (!(replayError instanceof RunFinalizationConflictError)) throw replayError;
        if (replayError.reason === "stale_claim") return fail("stale_claim", 409);
      }
      await advanceLoopAfterRun(
        storage,
        loop,
        existing,
        new Date(existing.updatedAt),
        existing.status === "succeeded",
        advancement,
      );
      return ok({ run: publicRun(existing, false, { redactError: true }) });
    }
    return fail("run_not_running", 409);
  }
  if (existing.claimedBy !== principalId) return fail("runner_identity_mismatch", 403);
  const completion = normalizeRunCompletion({
    startedAt: existing.startedAt ?? existing.createdAt,
    requestedFinishedAt,
    requestedDurationMs,
    serverNow: now,
  });
  let finalized: LoopRun;
  try {
    finalized = await storage.finalizeRun(
      runId,
      {
        status,
        finishedAt: completion.finishedAt,
        durationMs: completion.durationMs,
        stdout,
        stderr,
        error,
        exitCode,
        pid,
      },
      { claimedBy: existing.claimedBy, claimToken, now },
    );
  } catch (error) {
    if (!(error instanceof RunFinalizationConflictError)) throw error;
    if (error.reason === "stale_claim") return fail("stale_claim", 409);
    const terminal = await storage.getRun(runId);
    if (
      !terminal ||
      terminal.claimedBy !== principalId ||
      terminal.status !== status ||
      !["succeeded", "failed", "timed_out", "skipped"].includes(terminal.status)
    ) {
      throw error;
    }
    finalized = terminal;
  }
  if (finalized.status === "running") return fail("stale_claim", 409);
  await advanceLoopAfterRun(
    storage,
    loop,
    finalized,
    new Date(finalized.updatedAt),
    finalized.status === "succeeded",
    advancement,
  );
  return ok({ run: publicRun(finalized, false, { redactError: true }) });
}

async function acceptRunEvidence(storage: LoopStorageContract, principalId: string, runId: string, body: Record<string, unknown>, now: Date): Promise<Response> {
  const heartbeat = await heartbeatRun(storage, principalId, runId, body, now);
  if (!heartbeat.ok) return heartbeat;
  return ok({ accepted: true, evidence: scrubSecretsDeep(body.evidence ?? body) });
}

async function advanceLoopAfterRun(
  storage: LoopStorageContract,
  loop: Awaited<ReturnType<LoopStorageContract["getLoop"]>> & {},
  run: Awaited<ReturnType<LoopStorageContract["getRun"]>> & {},
  finishedAt: Date,
  succeeded: boolean,
  opts: {
    random: () => number;
    circuitBreakerThreshold?: CircuitBreakerThreshold;
    recoveredRun?: RecoveredLeaseRunSnapshotEntry;
  },
): Promise<void> {
  const retryRandom = opts.random();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await storage.getLoop(loop.id);
    const threshold = current ? resolveBreakerThreshold(current, opts.circuitBreakerThreshold) : 0;
    const plan = planLoopAdvancement({
      current,
      run,
      finishedAt,
      succeeded,
      deferredRetry: current
        ? await storage.nextRetryableRun(current.id, current.maxAttempts)
        : undefined,
      retryIntentRun: current?.retryScheduledFor
        ? await storage.getRunBySlot(current.id, current.retryScheduledFor)
        : undefined,
      recentRuns: current
        ? await collectBreakerWindowRuns(
          (opts) => storage.listRuns({ loopId: current.id, ...opts }),
          Math.max(threshold * 4, 50),
        )
        : [],
      retryRandom,
      circuitBreakerThreshold: threshold,
    });
    if (plan.kind === "none") return;
    if (loopAdvancementPatchMatchesCurrent(current!, plan.patch)) return;
    const applied = plan.kind === "circuit_breaker"
      ? await storage.tripCircuitBreakerIfCurrent(
        current!.id,
        current!,
        plan.patch,
        { scheduledFor: plan.markerScheduledFor, reason: plan.reason },
        { recoveredRun: opts.recoveredRun },
      )
      : plan.kind === "expires_after_runs"
        ? await storage.expireLoopIfCurrent(
          current!.id,
          current!,
          plan.patch,
          { scheduledFor: plan.markerScheduledFor, reason: plan.reason },
          { recoveredRun: opts.recoveredRun },
        )
        : await storage.advanceLoopIfCurrent(current!.id, current!, plan.patch, {
          recoveredRun: opts.recoveredRun,
        });
    if (applied) return;
    if (opts.recoveredRun) {
      const latest = await storage.getRun(opts.recoveredRun.id);
      if (!matchesRecoveredLeaseSnapshot(latest, opts.recoveredRun)) return;
    }
    if (attempt === 1) throw new LoopAdvancementConflictError(loop.id, run.id);
  }
}

const RECOVERED_LEASE_ERROR = "run lease expired before completion";

function isRecoveredLeaseRun(run: LoopRun): boolean {
  return run.status === "abandoned" && run.error === RECOVERED_LEASE_ERROR;
}

function recoveredLeaseSnapshotEntry(run: LoopRun): RecoveredLeaseRunSnapshotEntry {
  return {
    id: run.id,
    attempt: run.attempt,
    updatedAt: run.updatedAt,
    scheduledFor: run.scheduledFor,
  };
}

function matchesRecoveredLeaseSnapshot(
  run: LoopRun | undefined,
  expected: RecoveredLeaseRunSnapshotEntry,
): run is LoopRun {
  return Boolean(
    run &&
    isRecoveredLeaseRun(run) &&
    run.attempt === expected.attempt &&
    run.updatedAt === expected.updatedAt &&
    run.scheduledFor === expected.scheduledFor
  );
}

async function advanceRecoveredLeaseRunPages(
  storage: LoopStorageContract,
  opts: {
    random: () => number;
    circuitBreakerThreshold?: CircuitBreakerThreshold;
  },
): Promise<LoopRun[]> {
  const advancementDeferred: LoopRun[] = [];
  let snapshot: Awaited<ReturnType<LoopStorageContract["listRecoveredLeaseRunsPage"]>>["snapshot"];
  let offset = 0;
  for (;;) {
    const page = await storage.listRecoveredLeaseRunsPage({ snapshot, offset, limit: MAX_PAGE_LIMIT });
    snapshot = page.snapshot;
    try {
      advancementDeferred.push(...await advanceRecoveredRuns(storage, page.runs, opts));
    } catch {
      // One page's recovery advancement must not abort the whole pass: the
      // page's runs stay recovered and are retried on the next invocation.
    }
    if (page.nextOffset === undefined) break;
    if (page.nextOffset <= offset) throw new Error("recovered lease replay offset did not advance");
    offset = page.nextOffset;
  }
  return advancementDeferred;
}

async function advanceRecoveredRuns(
  storage: LoopStorageContract,
  runs: readonly LoopRun[],
  opts: {
    random: () => number;
    circuitBreakerThreshold?: CircuitBreakerThreshold;
  },
): Promise<LoopRun[]> {
  const deferred: LoopRun[] = [];
  const unexpected: unknown[] = [];
  for (const staleRun of runs) {
    const expected = recoveredLeaseSnapshotEntry(staleRun);
    const run = await storage.getRun(staleRun.id);
    if (!matchesRecoveredLeaseSnapshot(run, expected)) continue;
    const loop = await storage.getLoop(run.loopId);
    if (!loop) continue;
    try {
      await advanceLoopAfterRun(
        storage,
        loop,
        run,
        new Date(run.updatedAt),
        false,
        { ...opts, recoveredRun: expected },
      );
    } catch (error) {
      if (error instanceof LoopAdvancementConflictError) deferred.push(run);
      else unexpected.push(error);
    }
  }
  if (unexpected.length > 0) {
    throw new AggregateError(unexpected, `recovery advancement failed for ${unexpected.length} run(s)`);
  }
  return deferred;
}

function runnerLeaseMs(leaseMs: number): number {
  return Math.max(MIN_RUNNER_LEASE_MS, leaseMs);
}

function requireStorage(storage: LoopStorageContract | undefined): LoopStorageContract {
  if (!storage) throw apiError("storage_unconfigured", 503);
  return storage;
}

async function readJsonBody<T>(request: Request, limitBytes: number): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!isJsonContentType(contentType)) throw apiError("unsupported_media_type", 415);
  const text = await readBodyText(request, limitBytes);
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw apiError("invalid_json", 400);
  }
}

async function readWorkflowRecoveryBody(
  request: Request,
  limitBytes: number,
): Promise<{ reason?: string }> {
  if (request.body === null) return {};
  const body = await readJsonBody<unknown>(request, limitBytes);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw apiError("invalid_workflow_recovery_body", 422);
  }
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "reason") ||
    (record.reason !== undefined && typeof record.reason !== "string")
  ) {
    throw apiError("invalid_workflow_recovery_body", 422);
  }
  return record.reason === undefined ? {} : { reason: record.reason };
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

async function readBodyText(request: Request, limitBytes: number): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) throw apiError("invalid_content_length", 400);
    if (declaredBytes > limitBytes) throw apiError("body_too_large", 413);
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    receivedBytes += value.byteLength;
    if (receivedBytes > limitBytes) {
      await reader.cancel().catch(() => undefined);
      throw apiError("body_too_large", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// Per-request page cap. A single response never streams more than this many rows
// into memory; larger result sets are walked with `offset` pagination. Values
// above the cap are clamped (not rejected) so a caller asking for "everything"
// still gets a valid first page instead of a 422 or an empty array.
const MAX_PAGE_LIMIT = 1000;

function optionalLimit(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw apiError("invalid_limit", 422);
  return Math.min(limit, MAX_PAGE_LIMIT);
}

function optionalOffset(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0) throw apiError("invalid_offset", 422);
  return offset;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw apiError("invalid_string", 422);
  return value.trim();
}

function labelsFromSearchParams(params: URLSearchParams): string[] {
  const repeated = params.getAll("label");
  const packed = params.get("labels")?.split(",") ?? [];
  return normalizedLabels([...repeated, ...packed].filter((label) => label !== ""));
}

function normalizedLabels(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((label) => typeof label !== "string")) {
    throw apiError("invalid_labels", 422);
  }
  try {
    return normalizeLoopLabels(value as string[]);
  } catch {
    throw apiError("invalid_labels", 422);
  }
}

function requiredString(value: unknown, name: string): string {
  const result = optionalString(value);
  if (!result) throw apiError(`${name}_required`, 422);
  return result;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw apiError("invalid_string", 422);
  return value;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const result = Number(value);
  if (!Number.isInteger(result)) throw apiError("invalid_integer", 422);
  return result;
}

function optionalPositiveInteger(value: unknown, min: number, max: number): number | undefined {
  const result = optionalInteger(value);
  if (result === undefined) return undefined;
  if (result < min || result > max) throw apiError("invalid_integer_range", 422);
  return result;
}

function optionalIsoString(value: unknown): string | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw apiError("invalid_datetime", 422);
  return parsed.toISOString();
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw apiError("invalid_string_record", 422);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw apiError("invalid_string_record", 422);
    result[key] = entry;
  }
  return result;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw apiError("invalid_object", 422);
  return value as Record<string, unknown>;
}

function requiredObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw apiError("invalid_object", 422);
  return value as Record<string, unknown>;
}

function optionalBoolean(value: string | null): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no"].includes(value.toLowerCase())) return false;
  throw apiError("invalid_boolean", 422);
}

function optionalEnum<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  if (value == null || value === "") return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw apiError("invalid_filter", 422);
}

class PublicApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "PublicApiError";
  }
}

function apiError(code: string, status: number): PublicApiError {
  return new PublicApiError(code, status);
}

/**
 * Map a {@link CodedError} to its public failure response by the stable
 * machine-readable `.code`. The dist layout bundles api/index.ts and the
 * storage backends (sqlite, postgres) as separate bun bundles, so each carries
 * its own copy of the CodedError classes: a `LoopNotFoundError` thrown by the
 * storage bundle is NOT an instance of the api bundle's class, and the
 * `instanceof` chain in {@link errorResponse} alone turned every
 * not-found/conflict from the storage-backed write routes (DELETE included)
 * into a 500 `internal_error`. CodedError codes survive bundling unchanged, so
 * keying on `.code` maps storage-sourced errors to the same 404/409/422 the
 * api-bundle errors already returned. It is a last-resort fallback: `instanceof`
 * still runs first so same-bundle (and forged-prototype) errors keep their
 * existing mapping.
 */
function codedErrorFailure(error: unknown): Response | undefined {
  if (!error || typeof error !== "object") return undefined;
  // Snapshot the primitive fields exactly once inside a guard, mirroring
  // publicValidationDetails: a caller-controlled throwing getter must fail
  // closed (undefined -> internal_error), never crash the response path or
  // leak getter metadata into an error response.
  let code: unknown;
  let reason: unknown;
  try {
    const candidate = error as Record<string, unknown>;
    code = candidate.code;
    reason = candidate.reason;
  } catch {
    return undefined;
  }
  if (typeof code !== "string") return undefined;
  const safeReason = typeof reason === "string" ? reason : undefined;
  switch (code) {
    case "LOOP_NOT_FOUND":
      return fail("loop_not_found", 404);
    case "LOOP_ARCHIVED":
      return fail("loop_archived", 409);
    case "LOOP_ADVANCEMENT_CONFLICT":
      return fail("loop_advancement_conflict", 409);
    case "LOOP_MUTATION_CONFLICT":
      return safeReason ? fail(safeReason, 409) : undefined;
    case "AMBIGUOUS_NAME":
      return fail("ambiguous_name", 409);
    case "BUNDLE_STORAGE_UNAVAILABLE":
      return fail("bundle_storage_unavailable", 503);
    case "RUN_FINALIZATION_CONFLICT":
      return safeReason ? fail(safeReason, 409) : undefined;
    case "VALIDATION_ERROR": {
      const details = validationErrorPublicDetails(error as ValidationError);
      return fail("validation_failed", 422, details ? { details } : undefined);
    }
    case "WORKFLOW_RUN_PROVENANCE_MISSING":
      return fail("workflow_run_provenance_missing", 409);
    case "WORKFLOW_RUN_DEFINITION_CONFLICT":
      return fail("workflow_run_definition_conflict", 409);
    case "WORKFLOW_RUN_HAS_LIVE_STEPS":
      return fail("workflow_run_has_live_steps", 409);
    case "WORKFLOW_RUN_NOT_RUNNING":
      return fail("workflow_run_not_running", 409);
    case "WORKFLOW_RUN_STEP_OWNERSHIP_UNVERIFIABLE":
      return fail("workflow_run_step_ownership_unverifiable", 409);
    default:
      return undefined;
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof LoopNotFoundError) return fail("loop_not_found", 404);
  if (error instanceof LoopArchivedError) return fail("loop_archived", 409);
  if (error instanceof LoopAdvancementConflictError) return fail("loop_advancement_conflict", 409);
  if (error instanceof LoopMutationConflictError) return fail(error.reason, 409);
  if (error instanceof AmbiguousNameError) return fail("ambiguous_name", 409);
  if (error instanceof RunFinalizationConflictError) return fail(error.reason, 409);
  if (error instanceof ValidationError) {
    const details = validationErrorPublicDetails(error);
    return fail("validation_failed", 422, details ? { details } : undefined);
  }
  if (error instanceof LegacyWorkflowRunProvenanceError) return fail("workflow_run_provenance_missing", 409);
  if (error instanceof WorkflowRunDefinitionConflictError) return fail("workflow_run_definition_conflict", 409);
  if (error instanceof WorkflowRunHasLiveStepsError) return fail("workflow_run_has_live_steps", 409);
  if (error instanceof WorkflowRunNotRunningError) return fail("workflow_run_not_running", 409);
  if (error instanceof WorkflowRunStepOwnershipUnverifiableError) {
    return fail("workflow_run_step_ownership_unverifiable", 409);
  }
  if (error instanceof PublicApiError) return fail(error.code, error.status);
  // Cross-bundle fallback (codedErrorFailure): storage backends ship in their
  // own dist bundle with their own CodedError class copies, so their errors
  // defeat every instanceof check above. Their stable `.code` survives
  // bundling, so match on it last.
  return codedErrorFailure(error) ?? bundleErrorFailure(error) ?? fail("internal_error", 500);
}

/**
 * Map a bundle integrity/conflict code to its public failure.
 *
 * Matched on the stable `.code` rather than by `instanceof`, for the same
 * reason `codedErrorFailure` is: the dist layout bundles api/index.ts and the
 * bundle library separately, so class identity does not survive.
 */
function bundleErrorFailure(error: unknown): Response | undefined {
  if (!error || typeof error !== "object") return undefined;
  let code: unknown;
  let message: unknown;
  try {
    code = (error as Record<string, unknown>).code;
    message = (error as Record<string, unknown>).message;
  } catch {
    return undefined;
  }
  if (typeof code !== "string") return undefined;
  const status = BUNDLE_ERROR_STATUS[code] ?? (code.startsWith("BUNDLE_") || code.startsWith("UNEXPECTED_PART") || code.startsWith("DUPLICATE_PART") ? 400 : undefined);
  if (status === undefined) return undefined;
  // The message names paths and offsets only — never file contents and never a
  // matched credential value (see assertNoCredentials).
  return fail(code.toLowerCase(), status, typeof message === "string" ? { message } : undefined);
}

function requestIdentifier(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function logInternalFailure(request: Request, error: unknown, code: string, requestId = requestIdentifier(request)): void {
  // Never log request paths or Error fields here: both may contain credentials
  // supplied by a client or database provider. Stable code/request/method are
  // enough for correlation with protected infrastructure logs.
  console.error(JSON.stringify({
    evt: "loops_api_request_failed",
    code,
    requestId,
    method: request.method,
    route: "unknown_route",
    errorType: error instanceof Error ? "error" : typeof error,
  }));
}

export function logApiCommandFailure(error: unknown): void {
  console.error(JSON.stringify({
    evt: "loops_api_command_failed",
    errorType: error instanceof Error ? "error" : typeof error,
  }));
}

export async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv);
}

program.action(() => printStatus());

program.command("status").option("-j, --json", "print JSON").action((opts) => printStatus(opts));

// Only auto-run the loops-api CLI when THIS file is the direct entry. When bun
// bundles api/index.ts into another entry (e.g. loops-serve), it inlines this
// code and sets import.meta.main=true for the whole bundle; the URL check keeps
// this CLI from double-parsing argv against the serve program.
if (import.meta.main && (import.meta.url.endsWith("api/index.ts") || import.meta.url.endsWith("api/index.js"))) {
  main().catch((error) => {
    logApiCommandFailure(error);
    process.exit(1);
  });
}
