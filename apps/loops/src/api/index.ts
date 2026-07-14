#!/usr/bin/env bun
import { Command } from "commander";
import type {
  CreateLoopInput,
  CreateWorkflowInvocationInput,
  CreateWorkflowInput,
  Loop,
  LoopRun,
  LoopStatus,
  RunStatus,
  UpsertWorkflowWorkItemInput,
  WorkflowSpec,
  WorkflowWorkItemStatus,
  WriteRunReceiptInput,
} from "../types.js";
import type { GoalStatus } from "../lib/goal/types.js";
import { LoopArchivedError, LoopNotFoundError, ValidationError } from "../lib/errors.js";
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
  redact,
} from "../lib/format.js";
import { buildDeploymentStatus, deploymentStatusLine } from "../lib/mode.js";
import { computeNextAfter, dueSlots } from "../lib/recurrence.js";
import { scrubSecretsDeep } from "../lib/redact.js";
import type { LoopStorageContract } from "../lib/storage/contract.js";
import { routePolicy, type RoutePolicy } from "../lib/auth/route-policy.js";
import type { TenantAuthContext, TenantAuthDecision } from "../lib/auth/tenant-auth.js";
import { packageVersion } from "../lib/version.js";
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
  .description("OpenLoops self-hosted control-plane API foundation")
  .version(packageVersion())
  .option("-j, --json", "print JSON");

function wantsJson(opts?: { json?: boolean }): boolean {
  return Boolean(program.opts().json || opts?.json);
}

function printStatus(opts?: { json?: boolean }): void {
  const status = buildDeploymentStatus({ perspective: "self_hosted" });
  if (wantsJson(opts)) console.log(JSON.stringify(apiStatus(), null, 2));
  else console.log(deploymentStatusLine(status));
}

function ok(payload: Record<string, unknown> = {}, init?: ResponseInit): Response {
  return Response.json({ ok: true, ...payload }, init);
}

function fail(error: string, status: number, details?: Record<string, unknown>): Response {
  return Response.json({ ok: false, error, ...details }, { status });
}

export function apiStatus() {
  return {
    ok: true,
    service: "loops-api",
    status: buildDeploymentStatus({ perspective: "self_hosted" }),
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
  now?: () => Date;
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
      "pending_migrations" | "unknown_migrations";
  }>;
}

/** Deployment mode for the foundation probes ({ status, version, mode }). */
function foundationMode(): string {
  return buildDeploymentStatus({}).activeDeploymentMode;
}

/** Shared { status, version, mode } envelope for /health, /ready, /version. */
function foundationEnvelope(status: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { status, version: packageVersion(), mode: foundationMode(), service: "loops", ...extra };
}

const PUBLIC_READINESS_CODES = new Set([
  "storage_unconfigured",
  "storage_unreachable",
  "auth_unreachable",
  "unsafe_database_role",
  "pending_migrations",
  "unknown_migrations",
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
      // ── Open foundation probes ({ status, version, mode }) ───────────────
      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
        return Response.json(foundationEnvelope("ok"));
      }
      if (request.method === "GET" && (url.pathname === "/version" || url.pathname === "/v1/version")) {
        return Response.json(foundationEnvelope("ok"));
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
      const decision = await authenticator.authenticate(request.headers, {
        method: request.method,
        path: url.pathname,
        policy,
      });
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
          now: opts.now ?? (() => new Date()),
        });
      return withTenantStorage(principal, (storage) => execute(storage));
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
  now: () => Date;
}

async function handleV1Request(ctx: V1RequestContext): Promise<Response> {
  const segments = ctx.url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== "v1") return fail("not_found", 404);
  if (ctx.request.method === "GET" && segments.length === 1) return ok({ service: "loops-api", version: "v1" });
  if (ctx.request.method === "GET" && segments[1] === "status") return Response.json(apiStatus());
  try {
    if (segments[1] === "import") return await handleImportRequest(ctx, segments.slice(2));
    if (segments[1] === "loops") return await handleLoopsRequest(ctx, segments.slice(2));
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
    if (segments[1] === "leases" && segments[2] === "recover" && ctx.request.method === "POST") {
      if (ctx.auth.tokenKind === "machine" || !ctx.auth.roles.some((role) => role === "admin" || role === "service")) {
        return fail("maintenance_principal_required", 403);
      }
      const storage = requireStorage(ctx.storage);
      const recovered = await storage.recoverExpiredRunLeasesDetailed(ctx.now());
      return ok({
        abandoned: recovered.abandoned.map((run) => publicRun(run, false, { redactError: true })),
        deferred: recovered.deferred.map((run) => publicRun(run, false, { redactError: true })),
      });
    }
    return fail("not_found", 404);
  } catch (error) {
    return errorResponse(error);
  }
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
      status: optionalEnum<LoopStatus>(ctx.url.searchParams.get("status"), ["active", "paused", "stopped", "expired"]),
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
    const loop = await storage.createLoop(body);
    return ok({ loop: publicLoop(loop) }, { status: 201 });
  }
  // GET /v1/loops/count — total-row verification (the list route caps at 1000
  // with no offset, so counting a large backfilled table needs this).
  if (segments.length === 1 && segments[0] === "count" && ctx.request.method === "GET") {
    const count = await storage.countLoops(
      optionalEnum<LoopStatus>(ctx.url.searchParams.get("status"), ["active", "paused", "stopped", "expired"]),
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
    return ok({ loop: publicLoop(loop) });
  }
  if (segments.length === 1 && ctx.request.method === "PATCH") {
    const body = await readJsonBody<Partial<{ status: LoopStatus; nextRunAt: string | null; retryScheduledFor: string | null; expiresAt: string | null }>>(
      ctx.request,
      ctx.bodyLimitBytes,
    );
    // Only forward keys the caller actually sent. Store.updateLoop merges
    // {...current, ...patch}, so a present-but-undefined key overrides the
    // current value: emitting all four keys unconditionally wiped omitted
    // schedule fields (and set status=NULL -> NOT NULL 500). A key set to
    // JSON null is an explicit clear (mapped to undefined -> merged to null).
    const patch: Partial<{ status: LoopStatus; nextRunAt: string; retryScheduledFor: string; expiresAt: string }> = {};
    if ("status" in body && body.status !== undefined) patch.status = body.status;
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
  return fail("not_found", 404);
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
  if (segments.length === 2 && segments[1] === "steps" && ctx.request.method === "GET") {
    const steps = await storage.listWorkflowStepRuns(id);
    return ok({ steps: steps.map((step) => publicWorkflowStepRun(step)) });
  }
  if (segments.length === 2 && segments[1] === "events" && ctx.request.method === "GET") {
    const events = await storage.listWorkflowEvents(id, optionalLimit(ctx.url.searchParams.get("limit")) ?? 200);
    return ok({ events: events.map(publicWorkflowEvent) });
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
  if (segments.length === 2 && id && ["heartbeat", "finalize", "evidence"].includes(segments[1] ?? "") && ctx.request.method === "POST") {
    const storage = requireStorage(ctx.storage);
    const action = segments[1];
    const now = ctx.now();
    if (action === "heartbeat") return heartbeatRun(storage, ctx.auth.principalId, id, await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes), now);
    if (action === "finalize") return finalizeRun(storage, ctx.auth.principalId, id, await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes), now);
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
    const recovered = await storage.recoverExpiredRunLeasesDetailed(now, { runId: id, limit: 1, scanLimit: 1 });
    const abandoned = recovered.abandoned;
    const deferred = recovered.deferred;
    for (const run of abandoned) {
      const loop = await storage.getLoop(run.loopId);
      if (loop) await advanceLoopAfterRun(storage, loop, run, new Date(run.finishedAt ?? now), false);
    }
    return ok({
      abandoned: abandoned.map((run) => publicRun(run, false, { redactError: true })),
      deferred: deferred.map((run) => publicRun(run, false, { redactError: true })),
    });
  }

  const storage = requireStorage(ctx.storage);
  const showOutput = optionalBoolean(ctx.url.searchParams.get("showOutput")) ?? false;
  // GET /v1/runs/count — total-row verification (run history is far larger than
  // the 1000-row list cap).
  if (segments.length === 1 && id === "count" && ctx.request.method === "GET") {
    const count = await storage.countRuns(
      optionalEnum<RunStatus>(ctx.url.searchParams.get("status"), ["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"]),
    );
    return ok({ count });
  }
  if (segments.length === 0 && ctx.request.method === "GET") {
    const runs = await storage.listRuns({
      loopId: ctx.url.searchParams.get("loopId") ?? undefined,
      status: optionalEnum<RunStatus>(ctx.url.searchParams.get("status"), ["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"]),
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
  if (action === "register" || action === "heartbeat") {
    const body = await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes);
    const runner = runnerRecord(body);
    requireBoundRunner(ctx.auth, runner);
    return ok({ runner });
  }
  if (action === "poll" || action === "claim") {
    const storage = requireStorage(ctx.storage);
    const body = await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes);
    const runner = runnerRecord(body);
    requireBoundRunner(ctx.auth, runner);
    const claims = await claimRuns(storage, runner, {
      now: ctx.now(),
      maxClaims: optionalPositiveInteger(body.maxClaims, 1, 100) ?? 1,
    });
    return ok({ runner, claims });
  }
  return fail("not_found", 404);
}

function requireBoundRunner(auth: TenantAuthContext, runner: RunnerRecord): void {
  if (runner.id !== auth.principalId) {
    throw Object.assign(new Error("runner_identity_mismatch"), { status: 403 });
  }
}

interface RunnerRecord {
  id: string;
  machineId?: string;
  hostname?: string;
  labels: Record<string, string>;
  capabilities: Record<string, unknown>;
  lastSeenAt: string;
}

function runnerRecord(body: Record<string, unknown>): RunnerRecord {
  const machineId = optionalString(body.machineId);
  const hostname = optionalString(body.hostname);
  const id = optionalString(body.runnerId) ?? machineId ?? hostname;
  if (!id) throw Object.assign(new Error("runner_id_required"), { status: 422 });
  return {
    id,
    machineId,
    hostname,
    labels: stringRecord(body.labels),
    capabilities: objectRecord(body.capabilities),
    lastSeenAt: new Date().toISOString(),
  };
}

async function claimRuns(
  storage: LoopStorageContract,
  runner: RunnerRecord,
  opts: { now: Date; maxClaims: number },
): Promise<Array<Record<string, unknown>>> {
  const claims: Array<Record<string, unknown>> = [];
  for (const loop of await storage.dueLoops(opts.now)) {
    if (claims.length >= opts.maxClaims) break;
    if (!runnerMatchesLoop(loop.machine, runner)) continue;
    if (loop.target.type === "workflow") continue;
    if (loop.overlap === "skip" && (await storage.listRuns({ loopId: loop.id, status: "running", limit: 1 })).length > 0) continue;
    for (const slot of dueSlots(loop, opts.now).slots) {
      if (claims.length >= opts.maxClaims) break;
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
        loop: publicLoop(claim.loop),
        run: publicRun(run, false, { redactError: true }),
        claimToken: claim.claimToken,
      });
      if (loop.overlap === "skip") break;
    }
  }
  return claims;
}

function runnerMatchesLoop(machine: { id?: string; requestedId?: string } | undefined, runner: RunnerRecord): boolean {
  if (!machine) return true;
  const candidates = new Set([runner.id, runner.machineId, runner.hostname].filter(Boolean));
  return candidates.has(machine.id) || (machine.requestedId ? candidates.has(machine.requestedId) : false);
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

async function finalizeRun(storage: LoopStorageContract, principalId: string, runId: string, body: Record<string, unknown>, now: Date): Promise<Response> {
  const claimToken = requiredString(body.claimToken, "claimToken");
  const status = optionalEnum<"succeeded" | "failed" | "timed_out">(
    optionalString(body.status) ?? null,
    ["succeeded", "failed", "timed_out"],
  );
  if (!status) throw Object.assign(new Error("status_required"), { status: 422 });
  const existing = await storage.getRun(runId);
  if (!existing) return fail("run_not_found", 404);
  if (existing.status !== "running" || !existing.claimedBy) return fail("run_not_running", 409);
  if (existing.claimedBy !== principalId) return fail("runner_identity_mismatch", 403);
  const loop = await storage.getLoop(existing.loopId);
  if (!loop) return fail("loop_not_found", 404);
  const finishedAt = optionalIsoString(body.finishedAt) ?? new Date().toISOString();
  const durationMs = optionalPositiveInteger(body.durationMs, 0, Number.MAX_SAFE_INTEGER)
    ?? Math.max(0, new Date(finishedAt).getTime() - new Date(existing.startedAt ?? existing.createdAt).getTime());
  const finalized = await storage.finalizeRun(
    runId,
    {
      status,
      finishedAt,
      durationMs,
      stdout: optionalText(body.stdout) ?? "",
      stderr: optionalText(body.stderr) ?? "",
      error: optionalText(body.error),
      exitCode: optionalInteger(body.exitCode),
      pid: optionalInteger(body.pid),
    },
    { claimedBy: existing.claimedBy, claimToken, now },
  );
  if (finalized.status === "running") return fail("stale_claim", 409);
  await advanceLoopAfterRun(storage, loop, finalized, new Date(finalized.finishedAt ?? finishedAt), finalized.status === "succeeded");
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
): Promise<void> {
  if (run.status === "running") return;
  const current = await storage.getLoop(loop.id);
  if (!current || current.status !== "active" || current.archivedAt) return;
  if (current.retryScheduledFor && current.retryScheduledFor !== run.scheduledFor) return;
  if (!succeeded && run.attempt < current.maxAttempts) {
    await storage.updateLoop(current.id, {
      status: "active",
      nextRunAt: new Date(finishedAt.getTime() + retryDelayMs(current, run)).toISOString(),
      retryScheduledFor: run.scheduledFor,
    });
    return;
  }
  const nextRunAt = computeNextAfter(current.schedule, new Date(run.scheduledFor), finishedAt);
  await storage.updateLoop(current.id, {
    status: nextRunAt ? "active" : "stopped",
    nextRunAt,
    retryScheduledFor: undefined,
  });
}

function retryDelayMs(loop: Awaited<ReturnType<LoopStorageContract["getLoop"]>> & {}, run: Awaited<ReturnType<LoopStorageContract["getRun"]>> & {}): number {
  const growth = 2 ** Math.min(Math.max(1, run.attempt) - 1, 20);
  return Math.min(6 * 60 * 60_000, loop.retryDelayMs * growth);
}

function runnerLeaseMs(leaseMs: number): number {
  return Math.max(MIN_RUNNER_LEASE_MS, leaseMs);
}

function requireStorage(storage: LoopStorageContract | undefined): LoopStorageContract {
  if (!storage) throw Object.assign(new Error("storage_unconfigured"), { status: 503, code: "storage_unconfigured" });
  return storage;
}

async function readJsonBody<T>(request: Request, limitBytes: number): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!isJsonContentType(contentType)) throw Object.assign(new Error("unsupported_media_type"), { status: 415 });
  const text = await readBodyText(request, limitBytes);
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

async function readBodyText(request: Request, limitBytes: number): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) throw Object.assign(new Error("invalid_content_length"), { status: 400 });
    if (declaredBytes > limitBytes) throw Object.assign(new Error("body_too_large"), { status: 413 });
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
      throw Object.assign(new Error("body_too_large"), { status: 413 });
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
  if (!Number.isInteger(limit) || limit < 1) throw Object.assign(new Error("invalid_limit"), { status: 422 });
  return Math.min(limit, MAX_PAGE_LIMIT);
}

function optionalOffset(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0) throw Object.assign(new Error("invalid_offset"), { status: 422 });
  return offset;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw Object.assign(new Error("invalid_string"), { status: 422 });
  return value.trim();
}

function requiredString(value: unknown, name: string): string {
  const result = optionalString(value);
  if (!result) throw Object.assign(new Error(`${name}_required`), { status: 422 });
  return result;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw Object.assign(new Error("invalid_string"), { status: 422 });
  return value;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const result = Number(value);
  if (!Number.isInteger(result)) throw Object.assign(new Error("invalid_integer"), { status: 422 });
  return result;
}

function optionalPositiveInteger(value: unknown, min: number, max: number): number | undefined {
  const result = optionalInteger(value);
  if (result === undefined) return undefined;
  if (result < min || result > max) throw Object.assign(new Error("invalid_integer_range"), { status: 422 });
  return result;
}

function optionalIsoString(value: unknown): string | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error("invalid_datetime"), { status: 422 });
  return parsed.toISOString();
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("invalid_string_record"), { status: 422 });
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw Object.assign(new Error("invalid_string_record"), { status: 422 });
    result[key] = entry;
  }
  return result;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("invalid_object"), { status: 422 });
  return value as Record<string, unknown>;
}

function optionalBoolean(value: string | null): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no"].includes(value.toLowerCase())) return false;
  throw Object.assign(new Error("invalid_boolean"), { status: 422 });
}

function optionalEnum<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  if (value == null || value === "") return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw Object.assign(new Error("invalid_filter"), { status: 422 });
}

function errorResponse(error: unknown): Response {
  if (error instanceof LoopNotFoundError) return fail("loop_not_found", 404, { message: error.message });
  if (error instanceof LoopArchivedError) return fail("loop_archived", 409, { message: error.message });
  if (error instanceof ValidationError) return fail("validation_failed", 422, { message: error.message });
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : status === 500 ? "internal_error" : message;
  return fail(code, status, status === 500 ? { message: redact(message, 240) } : undefined);
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
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
