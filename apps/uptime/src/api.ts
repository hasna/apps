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
  hostedAllowedOrigins?: string[];
  allowUnsafeRemoteMutations?: boolean;
}

export interface CreateApiHandlerOptions {
  apiToken?: string;
  hostedToken?: string;
  hostedTokens?: HostedToken[];
  hostedAllowedOrigins?: string[];
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
  actor?: string;
}

interface HostedActor {
  scopes: Set<HostedScope>;
  workspaceId: string;
  actor: string;
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
      if (request.method === "GET" && url.pathname === "/ready") {
        if (mode === "hosted") requireHostedActor(request, url, options, "uptime:read");
        const readiness = service.readiness();
        return json({
          service: "uptime",
          ...readiness,
          auth: mode === "hosted" ? { configured: true, checked: true } : { configured: false, checked: false },
        }, readiness.ok ? 200 : 503);
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
      hostedAllowedOrigins: options.hostedAllowedOrigins,
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
  const actor = requireHostedActor(request, url, options, scope);
  if (["POST", "PATCH", "DELETE"].includes(request.method)) {
    validateHostedMutationOrigin(request, url, options);
  }
  return handleApiRoute(service, request, url, apiPath, options, true, actor);
}

function validateHostedMutationOrigin(request: Request, url: URL, options: CreateApiHandlerOptions): void {
  const rawOrigin = request.headers.get("origin");
  const origin = normalizeOrigin(rawOrigin);
  if (rawOrigin && !origin) {
    throw new ApiError("cross-origin mutation rejected", 403);
  }
  if (!origin) return;
  const allowedOrigins = new Set([`${url.protocol}//${url.host}`, ...resolveHostedAllowedOrigins(options)]);
  if (!allowedOrigins.has(origin)) {
    throw new ApiError("cross-origin mutation rejected", 403);
  }
}

async function handleApiRoute(
  service: UptimeService,
  request: Request,
  url: URL,
  apiPath: string,
  options: CreateApiHandlerOptions,
  hosted: boolean,
  actor?: HostedActor,
): Promise<Response> {
  if (request.method === "GET" && apiPath === "/api/summary") {
    return json(service.summary({ workspaceId: actor?.workspaceId }));
  }
  if (request.method === "GET" && apiPath === "/api/report") {
    return json(service.buildReport({ workspaceId: actor?.workspaceId }));
  }
  if (request.method === "POST" && apiPath === "/api/report") {
    if (hosted) throw new ApiError("hosted report delivery requires configured channel refs", 501);
    const input = await jsonBody(request);
    return json(await service.sendReport({ ...input, fetchImpl: options.fetchImpl }));
  }
  if (hosted && (apiPath.startsWith("/api/report-schedules") || apiPath.startsWith("/api/report-runs") || apiPath.startsWith("/api/audit-events"))) {
    throw new ApiError("hosted report schedules require cloud channel refs, workspace stores, and audit logging", 501);
  }
  if (hosted && apiPath.startsWith("/api/probes")) {
    throw new ApiError("hosted probe APIs require cloud check_jobs, workspace stores, and audit logging", 501);
  }
  if (request.method === "GET" && apiPath === "/api/report-schedules") {
    return json(service.listReportSchedules({ includeDisabled: url.searchParams.get("includeDisabled") === "true" }));
  }
  if (request.method === "POST" && apiPath === "/api/report-schedules") {
    return json(service.createReportSchedule(await jsonBody(request)), 201);
  }
  if (request.method === "POST" && apiPath === "/api/report-schedules/run-due") {
    const input = await jsonBody(request);
    const now = input.now ? new Date(input.now) : new Date();
    return json(await service.runDueReportSchedules(now, { fetchImpl: options.fetchImpl }));
  }
  const reportScheduleRunMatch = apiPath.match(/^\/api\/report-schedules\/([^/]+)\/run$/);
  if (request.method === "POST" && reportScheduleRunMatch) {
    return json(await service.runReportSchedule(decodeURIComponent(reportScheduleRunMatch[1]), { fetchImpl: options.fetchImpl }));
  }
  const reportScheduleMatch = apiPath.match(/^\/api\/report-schedules\/([^/]+)$/);
  if (reportScheduleMatch) {
    const id = decodeURIComponent(reportScheduleMatch[1]);
    if (request.method === "GET") {
      const schedule = service.getReportSchedule(id);
      return schedule ? json(schedule) : json({ error: "not found" }, 404);
    }
    if (request.method === "PATCH") {
      return json(service.updateReportSchedule(id, await jsonBody(request)));
    }
    if (request.method === "DELETE") {
      return json({ deleted: service.deleteReportSchedule(id) });
    }
  }
  if (request.method === "GET" && apiPath === "/api/report-runs") {
    return json(service.listReportRuns({
      scheduleId: url.searchParams.get("scheduleId") ?? undefined,
      limit: numericParam(url, "limit", 50),
    }));
  }
  if (request.method === "GET" && apiPath === "/api/audit-events") {
    return json(service.listAuditEvents({
      resourceType: url.searchParams.get("resourceType") ?? undefined,
      resourceId: url.searchParams.get("resourceId") ?? undefined,
      limit: numericParam(url, "limit", 50),
    }));
  }
  if (request.method === "GET" && apiPath === "/api/monitors") {
    return json(service.listMonitors({ includeDisabled: url.searchParams.get("includeDisabled") === "true", workspaceId: actor?.workspaceId }));
  }
  if (request.method === "POST" && apiPath === "/api/monitors") {
    const monitor = service.createMonitor(await jsonBody(request), { workspaceId: actor?.workspaceId });
    if (hosted && actor) recordHostedMonitorAudit(service, actor, "monitor.create", monitor, { method: request.method, apiPath });
    return json(monitor, 201);
  }
  if (request.method === "GET" && apiPath === "/api/incidents") {
    const status = url.searchParams.get("status");
    return json(service.listIncidents({
      status: status === "open" || status === "closed" ? status : undefined,
      monitorId: url.searchParams.get("monitorId") ?? undefined,
      workspaceId: actor?.workspaceId,
      limit: numericParam(url, "limit", 50),
    }));
  }
  if (request.method === "GET" && apiPath === "/api/results") {
    return json(service.listResults({
      monitorId: url.searchParams.get("monitorId") ?? undefined,
      workspaceId: actor?.workspaceId,
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
    return json(service.previewImport(await jsonBody(request), { workspaceId: actor?.workspaceId }));
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
      const monitor = service.getMonitor(id, { workspaceId: actor?.workspaceId });
      return monitor ? json(monitor) : json({ error: "not found" }, 404);
    }
    if (request.method === "PATCH" && !monitorMatch[2]) {
      const before = hosted ? service.getMonitor(id, { workspaceId: actor?.workspaceId }) : null;
      const monitor = service.updateMonitor(id, await jsonBody(request), { workspaceId: actor?.workspaceId });
      if (hosted && actor) {
        recordHostedMonitorAudit(service, actor, "monitor.update", monitor, {
          method: request.method,
          apiPath,
          previousRevision: before?.revision ?? null,
          nextRevision: monitor.revision,
        });
      }
      return json(monitor);
    }
    if (request.method === "DELETE" && !monitorMatch[2]) {
      const before = hosted ? service.getMonitor(id, { workspaceId: actor?.workspaceId }) : null;
      const deleted = service.deleteMonitor(id, { workspaceId: actor?.workspaceId });
      if (hosted && actor && deleted && before) {
        recordHostedMonitorAudit(service, actor, "monitor.delete", before, { method: request.method, apiPath });
      }
      return json({ deleted });
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
  if (apiPath.startsWith("/api/report-schedules") || apiPath.startsWith("/api/report-runs")) return method === "GET" ? "uptime:read" : "uptime:report";
  if (apiPath.startsWith("/api/audit-events")) return method === "GET" ? "uptime:read" : "uptime:admin";
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
  return {
    scopes,
    workspaceId,
    actor: token.actor ?? `hosted-token:${workspaceId}:${[...scopes].sort().join(",")}`,
  };
}

function recordHostedMonitorAudit(
  service: UptimeService,
  actor: HostedActor,
  action: "monitor.create" | "monitor.update" | "monitor.delete",
  monitor: { id: string; name: string; kind: string; enabled: boolean; revision: number; workspaceId: string },
  metadata: Record<string, unknown>,
): void {
  service.recordAuditEvent({
    workspaceId: actor.workspaceId,
    action,
    actor: actor.actor,
    resourceType: "monitor",
    resourceId: monitor.id,
    metadata: {
      ...metadata,
      monitorName: monitor.name,
      monitorKind: monitor.kind,
      monitorEnabled: monitor.enabled,
      monitorRevision: monitor.revision,
      workspaceId: monitor.workspaceId,
      scopes: [...actor.scopes].sort(),
    },
  });
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
  const defaultWorkspaceId = process.env.HASNA_UPTIME_WORKSPACE_ID ?? "default";
  if (options.hostedTokens?.length) {
    return normalizeHostedTokenEntries(options.hostedTokens, defaultWorkspaceId);
  }
  const configuredTokens = process.env.HASNA_UPTIME_HOSTED_TOKENS;
  if (configuredTokens?.trim()) {
    return parseHostedTokensConfig(configuredTokens, defaultWorkspaceId, "HASNA_UPTIME_HOSTED_TOKENS");
  }
  const token = options.hostedToken ?? process.env.HASNA_UPTIME_HOSTED_TOKEN;
  if (!token?.trim()) return [];
  return parseHostedTokenValue(token, defaultWorkspaceId, options.hostedToken ? "--hosted-token" : "HASNA_UPTIME_HOSTED_TOKEN");
}

const HOSTED_SCOPES: readonly HostedScope[] = ["uptime:read", "uptime:write", "uptime:probe", "uptime:report", "uptime:admin"];
const HOSTED_SCOPE_SET = new Set<HostedScope>(HOSTED_SCOPES);
const LEGACY_HOSTED_TOKEN_SCOPES: HostedScope[] = ["uptime:read", "uptime:write", "uptime:probe", "uptime:report"];

function parseHostedTokenValue(value: string, defaultWorkspaceId: string, source: string): HostedToken[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseHostedTokensConfig(trimmed, defaultWorkspaceId, source);
  }
  if (isHostedProductionMode()) {
    throw new ApiError(`${source} must be scoped hosted token JSON when hosted auth mode or NODE_ENV is production`, 500);
  }
  return [{
    token: trimmed,
    scopes: LEGACY_HOSTED_TOKEN_SCOPES,
    workspaceId: defaultWorkspaceId,
  }];
}

function parseHostedTokensConfig(value: string, defaultWorkspaceId: string, source: string): HostedToken[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ApiError(`${source} must be valid hosted token JSON`, 500);
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.tokens)
      ? parsed.tokens
      : isRecord(parsed) && typeof parsed.token === "string"
        ? [parsed]
        : undefined;
  if (!entries) throw new ApiError(`${source} must be a token object, token array, or object with tokens[]`, 500);
  return normalizeHostedTokenEntries(entries, defaultWorkspaceId, source);
}

function normalizeHostedTokenEntries(entries: unknown[], defaultWorkspaceId: string, source = "hostedTokens"): HostedToken[] {
  const tokens = entries.map((entry, index) => normalizeHostedTokenEntry(entry, defaultWorkspaceId, `${source}[${index}]`));
  if (tokens.length === 0) throw new ApiError(`${source} must configure at least one hosted token`, 500);
  return tokens;
}

function normalizeHostedTokenEntry(entry: unknown, defaultWorkspaceId: string, source: string): HostedToken {
  if (!isRecord(entry)) throw new ApiError(`${source} must be an object`, 500);
  if (typeof entry.token !== "string" || !entry.token.trim()) {
    throw new ApiError(`${source}.token is required`, 500);
  }
  const scopes = normalizeHostedScopes(entry.scopes, `${source}.scopes`);
  const workspaceId = typeof entry.workspaceId === "string" && entry.workspaceId.trim()
    ? entry.workspaceId.trim()
    : defaultWorkspaceId;
  const actor = typeof entry.actor === "string" && entry.actor.trim()
    ? entry.actor.trim()
    : typeof entry.subject === "string" && entry.subject.trim()
      ? entry.subject.trim()
      : typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : undefined;
  return { token: entry.token.trim(), scopes, workspaceId, actor };
}

function normalizeHostedScopes(value: unknown, source: string): HostedScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(`${source} must be a non-empty array`, 500);
  }
  const scopes = new Set<HostedScope>();
  for (const scope of value) {
    if (typeof scope !== "string" || !HOSTED_SCOPE_SET.has(scope as HostedScope)) {
      throw new ApiError(`${source} contains an invalid hosted scope`, 500);
    }
    scopes.add(scope as HostedScope);
  }
  return [...scopes];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHostedProductionMode(): boolean {
  return runtimeEnv("HASNA_UPTIME_HOSTED_AUTH_MODE") === "production" || runtimeEnv("NODE_ENV") === "production";
}

function runtimeEnv(name: string): string | undefined {
  return process.env[name];
}

function resolveHostedAllowedOrigins(options: Pick<CreateApiHandlerOptions, "hostedAllowedOrigins">): string[] {
  const configured = options.hostedAllowedOrigins ?? splitCsv(process.env.HASNA_UPTIME_ALLOWED_ORIGINS);
  return configured.map((origin) => normalizeAllowedOrigin(origin)).filter((origin): origin is string => Boolean(origin));
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function normalizeAllowedOrigin(value: string): string | undefined {
  const origin = normalizeOrigin(value);
  if (!origin) {
    throw new ApiError(`invalid hosted allowed origin: ${value}`, 500);
  }
  return origin;
}

function normalizeOrigin(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return undefined;
  }
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
