import { timingSafeEqual } from "node:crypto";
import { dashboardHtml } from "./dashboard.js";
import { UptimeService, type UptimeServiceOptions } from "./service.js";
import { resolveRuntimeMode, type UptimeRuntimeMode } from "./store.js";
import type { SchedulerHandle } from "./types.js";

export interface ServeOptions extends UptimeServiceOptions {
  host?: string;
  port?: number;
  check?: boolean;
  service?: UptimeService;
  apiToken?: string;
  hostedToken?: string;
  hostedTokens?: HostedToken[];
  allowUnsafeRemoteMutations?: boolean;
}

export interface CreateApiHandlerOptions {
  apiToken?: string;
  hostedToken?: string;
  hostedTokens?: HostedToken[];
  allowUnsafeRemoteMutations?: boolean;
  fetchImpl?: typeof fetch;
  trustedLoopback?: boolean;
  mode?: UptimeRuntimeMode;
}

export type HostedScope = "uptime:read" | "uptime:write" | "uptime:probe" | "uptime:report" | "uptime:admin";

export interface HostedToken {
  token: string;
  scopes: HostedScope[];
  workspaceId?: string;
}

interface HostedActor {
  scopes: Set<HostedScope>;
  workspaceId: string;
}

export function createApiHandler(service: UptimeService, options: CreateApiHandlerOptions = {}): (request: Request) => Promise<Response> {
  const mode = options.mode ? resolveRuntimeMode(options.mode) : service.store.mode;
  if (mode !== service.store.mode) {
    throw new Error(`API mode ${mode} does not match store mode ${service.store.mode}`);
  }
  return async (request: Request) => {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "uptime", mode, dataMode: service.store.dataMode });
      }
      if (mode === "hosted") {
        return await handleHostedRequest(service, request, url, options);
      } else {
        validateLocalMutationRequest(request, url, options);
      }
      if (request.method === "GET" && url.pathname === "/") {
        return html(dashboardHtml());
      }
      return await handleApiRoute(service, request, url, url.pathname, options, false);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        error instanceof ApiError ? error.status : 400,
      );
    }
  };
}

export function serveUptime(options: ServeOptions = {}): { server: ReturnType<typeof Bun.serve>; service: UptimeService; scheduler?: SchedulerHandle } {
  const requestedMode = options.mode ? resolveRuntimeMode(options.mode) : options.service?.store.mode ?? "local";
  if (requestedMode === "hosted" && resolveHostedTokens(options).length === 0) {
    throw new Error("hosted mode requires HASNA_UPTIME_HOSTED_TOKEN or --hosted-token");
  }
  const service = options.service ?? new UptimeService(options);
  const mode = service.store.mode;
  if (mode !== requestedMode) {
    throw new Error(`serve mode ${requestedMode} does not match store mode ${mode}`);
  }
  if (mode === "hosted" && options.check) {
    throw new Error("hosted scheduler requires check_jobs and probes");
  }
  const scheduler = options.check ? service.startScheduler() : undefined;
  const server = Bun.serve({
    hostname: options.host ?? "127.0.0.1",
    port: options.port ?? 3899,
    fetch: createApiHandler(service, {
      apiToken: options.apiToken,
      hostedToken: options.hostedToken,
      hostedTokens: options.hostedTokens,
      allowUnsafeRemoteMutations: options.allowUnsafeRemoteMutations,
      trustedLoopback: isLoopbackHost(options.host ?? "127.0.0.1"),
      mode,
    }),
  });
  return { server, service, scheduler };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function html(value: string): Response {
  return new Response(value, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function numericParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validateLocalMutationRequest(request: Request, url: URL, options: CreateApiHandlerOptions): void {
  if (!["POST", "PATCH", "DELETE"].includes(request.method)) return;
  const apiToken = resolveApiToken(options.apiToken);
  const hasToken = apiToken ? hasValidApiToken(request, apiToken) : false;
  const allowUnsafeRemote = options.allowUnsafeRemoteMutations || process.env.HASNA_UPTIME_ALLOW_REMOTE_MUTATIONS === "1";
  const trustedLoopback = options.trustedLoopback ?? isLoopbackHost(url.hostname);
  if (!allowUnsafeRemote && !hasToken && (!trustedLoopback || !isLoopbackHost(url.hostname))) {
    throw new ApiError("non-loopback host rejected for local mutation", 403);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== `${url.protocol}//${url.host}`) {
    throw new ApiError("cross-origin mutation rejected", 403);
  }
}

async function handleHostedRequest(service: UptimeService, request: Request, url: URL, options: CreateApiHandlerOptions): Promise<Response> {
  if (url.pathname === "/") {
    requireHostedActor(request, url, options, "uptime:read");
    throw new ApiError("hosted dashboard requires the cloud dashboard shell", 501);
  }
  if (!url.pathname.startsWith("/api/v1/")) {
    requireHostedActor(request, url, options, "uptime:read");
    return json({ error: "not found" }, 404);
  }
  const apiPath = `/api${url.pathname.slice("/api/v1".length)}`;
  const scope = hostedScopeFor(request.method, apiPath);
  requireHostedActor(request, url, options, scope);
  if (["POST", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== `${url.protocol}//${url.host}`) {
      throw new ApiError("cross-origin mutation rejected", 403);
    }
  }
  return handleApiRoute(service, request, url, apiPath, options, true);
}

async function handleApiRoute(
  service: UptimeService,
  request: Request,
  url: URL,
  apiPath: string,
  options: CreateApiHandlerOptions,
  hosted: boolean,
): Promise<Response> {
  if (request.method === "GET" && apiPath === "/api/summary") {
    return json(service.summary());
  }
  if (request.method === "GET" && apiPath === "/api/report") {
    return json(service.buildReport());
  }
  if (request.method === "POST" && apiPath === "/api/report") {
    if (hosted) throw new ApiError("hosted report delivery requires configured channel refs", 501);
    const input = await jsonBody(request);
    return json(await service.sendReport({ ...input, fetchImpl: options.fetchImpl }));
  }
  if (hosted && apiPath.startsWith("/api/probes")) {
    throw new ApiError("hosted probe APIs require cloud check_jobs, workspace stores, and audit logging", 501);
  }
  if (request.method === "GET" && apiPath === "/api/monitors") {
    return json(service.listMonitors({ includeDisabled: url.searchParams.get("includeDisabled") === "true" }));
  }
  if (request.method === "POST" && apiPath === "/api/monitors") {
    return json(service.createMonitor(await jsonBody(request)), 201);
  }
  if (request.method === "GET" && apiPath === "/api/incidents") {
    const status = url.searchParams.get("status");
    return json(service.listIncidents({
      status: status === "open" || status === "closed" ? status : undefined,
      monitorId: url.searchParams.get("monitorId") ?? undefined,
      limit: numericParam(url, "limit", 50),
    }));
  }
  if (request.method === "GET" && apiPath === "/api/results") {
    return json(service.listResults({
      monitorId: url.searchParams.get("monitorId") ?? undefined,
      limit: numericParam(url, "limit", 50),
    }));
  }
  if (request.method === "GET" && apiPath === "/api/probes") {
    return json(service.listProbes({ includeDisabled: url.searchParams.get("includeDisabled") === "true" }));
  }
  if (request.method === "POST" && apiPath === "/api/probes") {
    const input = await jsonBody(request);
    if (!input.publicKeyPem) throw new ApiError("API probe creation requires publicKeyPem; generate keys in the probe agent or CLI", 400);
    return json(service.createProbe(input), 201);
  }
  if (request.method === "POST" && apiPath === "/api/probes/jobs") {
    return json(service.createProbeCheckJob(await jsonBody(request)), 201);
  }
  const probeJobMatch = apiPath.match(/^\/api\/probes\/jobs\/([^/]+)$/);
  if (probeJobMatch) {
    const jobId = decodeURIComponent(probeJobMatch[1]);
    if (request.method === "GET") {
      const job = service.getProbeCheckJob(jobId);
      return job ? json({ ...job, fencingToken: null }) : json({ error: "not found" }, 404);
    }
  }
  const probeJobClaimMatch = apiPath.match(/^\/api\/probes\/jobs\/([^/]+)\/claim$/);
  if (request.method === "POST" && probeJobClaimMatch) {
    const input = await jsonBody(request);
    return json(service.claimProbeCheckJob({
      jobId: decodeURIComponent(probeJobClaimMatch[1]),
      probeId: input.probeId,
      leaseTtlMs: input.leaseTtlMs,
    }));
  }
  if (request.method === "POST" && apiPath === "/api/probes/results") {
    return json(service.submitProbeResult(await jsonBody(request)), 201);
  }
  if (request.method === "POST" && apiPath === "/api/imports/preview") {
    return json(service.previewImport(await jsonBody(request)));
  }
  if (request.method === "POST" && apiPath === "/api/imports/apply") {
    if (hosted) throw new ApiError("hosted import apply requires cloud import_batches and audit", 501);
    return json(service.applyImport(await jsonBody(request)), 201);
  }
  const importRollbackMatch = apiPath.match(/^\/api\/imports\/([^/]+)\/rollback$/);
  if (request.method === "POST" && importRollbackMatch) {
    if (hosted) throw new ApiError("hosted import rollback requires cloud import_batches and audit", 501);
    return json(service.rollbackImport(decodeURIComponent(importRollbackMatch[1])));
  }
  if (request.method === "POST" && apiPath === "/api/check-all") {
    if (hosted) throw new ApiError("hosted checks require check_jobs and probes", 501);
    return json(await service.checkAll());
  }
  const monitorMatch = apiPath.match(/^\/api\/monitors\/([^/]+)(?:\/(check))?$/);
  if (monitorMatch) {
    const id = decodeURIComponent(monitorMatch[1]);
    if (request.method === "GET" && !monitorMatch[2]) {
      const monitor = service.getMonitor(id);
      return monitor ? json(monitor) : json({ error: "not found" }, 404);
    }
    if (request.method === "PATCH" && !monitorMatch[2]) {
      return json(service.updateMonitor(id, await jsonBody(request)));
    }
    if (request.method === "DELETE" && !monitorMatch[2]) {
      return json({ deleted: service.deleteMonitor(id) });
    }
    if (request.method === "POST" && monitorMatch[2] === "check") {
      if (hosted) throw new ApiError("hosted checks require check_jobs and probes", 501);
      return json(await service.checkMonitor(id));
    }
  }
  return json({ error: "not found" }, 404);
}

function hostedScopeFor(method: string, apiPath: string): HostedScope {
  if (method === "POST" && apiPath === "/api/report") return "uptime:report";
  if (apiPath.startsWith("/api/probes")) return method === "GET" ? "uptime:read" : "uptime:probe";
  if (method === "POST" && (apiPath === "/api/check-all" || /\/check$/.test(apiPath))) return "uptime:probe";
  if (method === "GET") return "uptime:read";
  if (method === "POST" || method === "PATCH" || method === "DELETE") return "uptime:write";
  return "uptime:read";
}

function requireHostedActor(request: Request, url: URL, options: CreateApiHandlerOptions, scope: HostedScope): HostedActor {
  const tokens = resolveHostedTokens(options);
  if (tokens.length === 0) throw new ApiError("hosted auth token is not configured", 503);
  const candidate = bearerToken(request) ?? request.headers.get("x-uptime-hosted-token")?.trim();
  const token = candidate ? tokens.find((entry) => safeTokenEqual(candidate, entry.token)) : undefined;
  if (!token) throw new ApiError("authentication required", 401);
  const scopes = new Set(token.scopes);
  if (!scopes.has(scope) && !scopes.has("uptime:admin")) {
    throw new ApiError("insufficient scope", 403);
  }
  const workspaceId = token.workspaceId ?? "default";
  const requestedWorkspace = request.headers.get("x-uptime-workspace")?.trim() || url.searchParams.get("workspaceId")?.trim();
  if (requestedWorkspace && requestedWorkspace !== workspaceId) {
    throw new ApiError("workspace access denied", 403);
  }
  return { scopes, workspaceId };
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function hasValidApiToken(request: Request, token: string): boolean {
  const bearer = bearerToken(request);
  const headerToken = request.headers.get("x-uptime-token")?.trim();
  return safeTokenEqual(bearer, token) || safeTokenEqual(headerToken, token);
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
}

function resolveApiToken(token?: string): string | undefined {
  const value = token ?? process.env.HASNA_UPTIME_API_TOKEN;
  return value?.trim() || undefined;
}

function resolveHostedTokens(options: Pick<CreateApiHandlerOptions, "hostedToken" | "hostedTokens">): HostedToken[] {
  if (options.hostedTokens?.length) return options.hostedTokens;
  const token = options.hostedToken ?? process.env.HASNA_UPTIME_HOSTED_TOKEN;
  if (!token?.trim()) return [];
  return [{
    token: token.trim(),
    scopes: ["uptime:read", "uptime:write", "uptime:probe", "uptime:report"],
    workspaceId: process.env.HASNA_UPTIME_WORKSPACE_ID ?? "default",
  }];
}

function safeTokenEqual(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  if (candidateBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(candidateBytes, expectedBytes);
}

async function jsonBody(request: Request): Promise<any> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    throw new ApiError("content-type must be application/json", 415);
  }
  return request.json();
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
