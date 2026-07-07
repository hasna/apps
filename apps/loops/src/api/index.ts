#!/usr/bin/env bun
import { timingSafeEqual } from "node:crypto";
import { Command } from "commander";
import type { CreateLoopInput, LoopStatus, RunStatus } from "../types.js";
import { LoopArchivedError, LoopNotFoundError, ValidationError } from "../lib/errors.js";
import { publicLoop, publicRun, redact } from "../lib/format.js";
import { expectedFanoutKeys, runnerFanoutKey, runnerMatchesLoopMachine } from "../lib/machines.js";
import { buildDeploymentStatus, deploymentStatusLine } from "../lib/mode.js";
import { computeNextAfter, dueSlots } from "../lib/recurrence.js";
import { scrubSecretsDeep } from "../lib/redact.js";
import type { LoopStorageContract } from "../lib/storage/contract.js";
import { packageVersion } from "../lib/version.js";

const program = new Command();
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_EVIDENCE_LIMIT_BYTES = 256 * 1024;
const MIN_RUNNER_LEASE_MS = 1_000;
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["succeeded", "failed", "timed_out", "abandoned", "skipped"]);

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

function configuredAuthToken(): string | undefined {
  return process.env.LOOPS_API_TOKEN?.trim() || process.env.HASNA_LOOPS_API_TOKEN?.trim();
}

function isLocalBind(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}

function bearerTokenMatches(authorization: string, token: string): boolean {
  const expected = `Bearer ${token}`;
  const a = new TextEncoder().encode(authorization);
  const b = new TextEncoder().encode(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorizeRequest(request: Request, host: string): Response | undefined {
  if (isLocalBind(host)) return undefined;
  const token = configuredAuthToken();
  if (!token) return Response.json({ ok: false, error: "auth_required" }, { status: 401 });
  const authorization = request.headers.get("authorization") ?? "";
  return bearerTokenMatches(authorization, token)
    ? undefined
    : Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
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

export interface LoopsApiServerOptions {
  host?: string;
  port?: number;
  storage?: LoopStorageContract;
  bodyLimitBytes?: number;
  evidenceLimitBytes?: number;
  now?: () => Date;
}

export function createLoopsApiServer(opts: LoopsApiServerOptions = {}) {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8787;
  if (!isLocalBind(host) && !configuredAuthToken()) {
    throw new Error("non-local loops-api binds require LOOPS_API_TOKEN or HASNA_LOOPS_API_TOKEN");
  }
  return Bun.serve({
    hostname: host,
    port,
    fetch(request) {
      const unauthorized = authorizeRequest(request, host);
      if (unauthorized) return unauthorized;
      const url = new URL(request.url);
      if (url.pathname === "/health" || url.pathname === "/status") {
        return Response.json(apiStatus());
      }
      return handleV1Request({
        request,
        url,
        storage: opts.storage,
        bodyLimitBytes: opts.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
        evidenceLimitBytes: opts.evidenceLimitBytes ?? DEFAULT_EVIDENCE_LIMIT_BYTES,
        now: opts.now ?? (() => new Date()),
      });
    },
  });
}

interface V1RequestContext {
  request: Request;
  url: URL;
  storage?: LoopStorageContract;
  bodyLimitBytes: number;
  evidenceLimitBytes: number;
  now: () => Date;
}

async function handleV1Request(ctx: V1RequestContext): Promise<Response> {
  const segments = ctx.url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== "v1") return fail("not_found", 404);
  if (ctx.request.method === "GET" && segments.length === 1) return ok({ service: "loops-api", version: "v1" });
  if (ctx.request.method === "GET" && segments[1] === "status") return Response.json(apiStatus());
  try {
    if (segments[1] === "loops") return await handleLoopsRequest(ctx, segments.slice(2));
    if (segments[1] === "runs") return await handleRunsRequest(ctx, segments.slice(2));
    if (segments[1] === "runners") return await handleRunnerRequest(ctx, segments.slice(2));
    if (segments[1] === "leases" && segments[2] === "recover" && ctx.request.method === "POST") {
      return runnerProtocolPending("lease recovery is implemented in the runner protocol stage");
    }
    return fail("not_found", 404);
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleLoopsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const storage = requireStorage(ctx.storage);
  if (segments.length === 0 && ctx.request.method === "GET") {
    const loops = await storage.listLoops({
      status: optionalEnum<LoopStatus>(ctx.url.searchParams.get("status"), ["active", "paused", "stopped", "expired"]),
      limit: optionalLimit(ctx.url.searchParams.get("limit")),
      includeArchived: optionalBoolean(ctx.url.searchParams.get("includeArchived")),
      archived: optionalBoolean(ctx.url.searchParams.get("archived")),
    });
    return ok({ loops: loops.map(publicLoop) });
  }
  if (segments.length === 0 && ctx.request.method === "POST") {
    const body = await readJsonBody<CreateLoopInput>(ctx.request, ctx.bodyLimitBytes);
    const loop = await storage.createLoop(body);
    return ok({ loop: publicLoop(loop) }, { status: 201 });
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
  return fail("not_found", 404);
}

async function handleRunsRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  const id = segments[0];
  if (segments.length === 2 && id && ["heartbeat", "finalize", "evidence"].includes(segments[1] ?? "") && ctx.request.method === "POST") {
    const storage = requireStorage(ctx.storage);
    const action = segments[1];
    const now = ctx.now();
    if (action === "heartbeat") return heartbeatRun(storage, id, await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes), now);
    if (action === "finalize") return finalizeRun(storage, id, await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes), now);
    return acceptRunEvidence(storage, id, await readJsonBody<Record<string, unknown>>(ctx.request, ctx.evidenceLimitBytes), now);
  }
  if (segments.length === 2 && id && segments[1] === "recover" && ctx.request.method === "POST") {
    const storage = requireStorage(ctx.storage);
    const now = ctx.now();
    // Scope to the requested run: the route is POST /v1/runs/:id/recover, so the
    // response and loop advancement must reflect only that run, not every
    // lease-expired run in the store. (The underlying store only exposes a
    // global lease sweep; we filter its result to :id.)
    const target = await storage.getRun(id);
    if (!target) return fail("run_not_found", 404);
    const recovered = await storage.recoverExpiredRunLeasesDetailed(now);
    const abandoned = recovered.abandoned.filter((run) => run.id === id);
    const deferred = recovered.deferred.filter((run) => run.id === id);
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
  if (segments.length === 0 && ctx.request.method === "GET") {
    const runs = await storage.listRuns({
      loopId: ctx.url.searchParams.get("loopId") ?? undefined,
      status: optionalEnum<RunStatus>(ctx.url.searchParams.get("status"), ["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"]),
      limit: optionalLimit(ctx.url.searchParams.get("limit")),
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

async function handleRunnerRequest(ctx: V1RequestContext, segments: string[]): Promise<Response> {
  if (ctx.request.method !== "POST") return fail("not_found", 404);
  const action = segments.length === 1 ? segments[0] : segments[1];
  if (action === "register" || action === "heartbeat") {
    const body = await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes);
    return ok({ runner: runnerRecord(body, ctx.now()) });
  }
  if (action === "poll" || action === "claim") {
    const storage = requireStorage(ctx.storage);
    const body = await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes);
    const runner = runnerRecord(body, ctx.now());
    const claims = await claimRuns(storage, runner, {
      now: ctx.now(),
      maxClaims: optionalPositiveInteger(body.maxClaims, 1, 100) ?? 1,
    });
    return ok({ runner, claims });
  }
  return fail("not_found", 404);
}

interface RunnerRecord {
  id: string;
  machineId?: string;
  hostname?: string;
  labels: Record<string, string>;
  capabilities: Record<string, unknown>;
  lastSeenAt: string;
}

function runnerRecord(body: Record<string, unknown>, now = new Date()): RunnerRecord {
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
    lastSeenAt: now.toISOString(),
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
    if (!runnerMatchesLoopMachine(loop.machine, loop.placement, runner)) continue;
    if (loop.target.type === "workflow") continue;
    const fanout = runnerFanoutKey(loop.placement, runner);
    if (loop.overlap === "skip" && fanout === "single" && (await storage.listRuns({ loopId: loop.id, status: "running", limit: 1 })).length > 0) continue;
    for (const slot of dueSlots(loop, opts.now).slots) {
      if (claims.length >= opts.maxClaims) break;
      const claim = await storage.claimRun(loop, slot, runner.id, opts.now, {
        fanoutKey: fanout,
        machineId: runner.machineId ?? runner.hostname ?? runner.id,
      });
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

async function heartbeatRun(storage: LoopStorageContract, runId: string, body: Record<string, unknown>, now: Date): Promise<Response> {
  const claimToken = requiredString(body.claimToken, "claimToken");
  const run = await storage.getRun(runId);
  if (!run) return fail("run_not_found", 404);
  if (run.status !== "running" || !run.claimedBy) return fail("run_not_running", 409);
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

async function finalizeRun(storage: LoopStorageContract, runId: string, body: Record<string, unknown>, now: Date): Promise<Response> {
  const claimToken = requiredString(body.claimToken, "claimToken");
  const status = optionalEnum<"succeeded" | "failed" | "timed_out">(
    optionalString(body.status) ?? null,
    ["succeeded", "failed", "timed_out"],
  );
  if (!status) throw Object.assign(new Error("status_required"), { status: 422 });
  const existing = await storage.getRun(runId);
  if (!existing) return fail("run_not_found", 404);
  if (existing.status !== "running" || !existing.claimedBy) return fail("run_not_running", 409);
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
  const advancedOrWaitingForFanout = await maybeAdvanceFanoutLoop(storage, loop, finalized, new Date(finalized.finishedAt ?? finishedAt));
  if (!advancedOrWaitingForFanout) {
    await advanceLoopAfterRun(storage, loop, finalized, new Date(finalized.finishedAt ?? finishedAt), finalized.status === "succeeded");
  }
  return ok({ run: publicRun(finalized, false, { redactError: true }) });
}

async function acceptRunEvidence(storage: LoopStorageContract, runId: string, body: Record<string, unknown>, now: Date): Promise<Response> {
  const heartbeat = await heartbeatRun(storage, runId, body, now);
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

async function maybeAdvanceFanoutLoop(
  storage: LoopStorageContract,
  loop: Awaited<ReturnType<LoopStorageContract["getLoop"]>> & {},
  run: Awaited<ReturnType<LoopStorageContract["getRun"]>> & {},
  finishedAt: Date,
): Promise<boolean> {
  const expected = expectedFanoutKeys(loop.placement);
  if (!expected?.length) return false;
  const expectedSet = new Set(expected);
  const slotRuns = (await storage.listRuns({ loopId: loop.id, limit: 10_000 }))
    .filter((candidate) => candidate.scheduledFor === run.scheduledFor && candidate.fanoutKey && expectedSet.has(candidate.fanoutKey));
  const latestByFanout = new Map<string, typeof slotRuns[number]>();
  for (const candidate of slotRuns) latestByFanout.set(candidate.fanoutKey!, candidate);
  if (latestByFanout.size < expectedSet.size) return true;
  const latestRuns = [...latestByFanout.values()];
  if (latestRuns.some((candidate) => candidate.status === "running")) return true;
  if (latestRuns.some((candidate) => !TERMINAL_RUN_STATUSES.has(candidate.status))) return true;
  if (latestRuns.some((candidate) => ["failed", "timed_out", "abandoned"].includes(candidate.status) && candidate.attempt < loop.maxAttempts)) return true;
  const failed = latestRuns.find((candidate) => candidate.status !== "succeeded" && candidate.status !== "skipped");
  await advanceLoopAfterRun(storage, loop, failed ?? run, finishedAt, !failed);
  return true;
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

function runnerProtocolPending(message: string): Response {
  return fail("runner_protocol_pending", 501, { message });
}

function optionalLimit(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Object.assign(new Error("invalid_limit"), { status: 422 });
  return limit;
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

program
  .command("serve")
  .description("serve the foundation health/status endpoints")
  .option("--host <host>", "host", "127.0.0.1")
  .option("--port <port>", "port", (value) => Number(value), 8787)
  .action((opts) => {
    const host = String(opts.host);
    const port = Number(opts.port);
    const server = createLoopsApiServer({ host, port });
    console.log(`loops-api listening on http://${server.hostname}:${server.port}`);
  });

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
