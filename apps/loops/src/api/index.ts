#!/usr/bin/env bun
import { timingSafeEqual } from "node:crypto";
import { Command } from "commander";
import type { CreateLoopInput, LoopStatus, RunStatus } from "../types.js";
import { LoopArchivedError, LoopNotFoundError, ValidationError } from "../lib/errors.js";
import { publicLoop, publicRun, redact } from "../lib/format.js";
import { buildDeploymentStatus, deploymentStatusLine } from "../lib/mode.js";
import type { LoopStorageContract } from "../lib/storage/contract.js";
import { packageVersion } from "../lib/version.js";

const program = new Command();
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_EVIDENCE_LIMIT_BYTES = 256 * 1024;

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
    const loop = await storage.updateLoop(id, {
      status: body.status,
      nextRunAt: body.nextRunAt === null ? undefined : body.nextRunAt,
      retryScheduledFor: body.retryScheduledFor === null ? undefined : body.retryScheduledFor,
      expiresAt: body.expiresAt === null ? undefined : body.expiresAt,
    });
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
    await readJsonBody<Record<string, unknown>>(ctx.request, segments[1] === "evidence" ? ctx.evidenceLimitBytes : ctx.bodyLimitBytes);
    return runnerProtocolPending(`run ${segments[1]} is implemented in the runner protocol stage`);
  }
  if (segments.length === 2 && id && segments[1] === "recover" && ctx.request.method === "POST") {
    return runnerProtocolPending("run recovery is implemented in the runner protocol stage");
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
  if (action && ["register", "heartbeat", "poll", "claim"].includes(action)) {
    await readJsonBody<Record<string, unknown>>(ctx.request, ctx.bodyLimitBytes);
    return runnerProtocolPending(`runner ${action} is implemented in the runner protocol stage`);
  }
  return fail("not_found", 404);
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
