/**
 * HTTP server for the Todos dashboard.
 * Serves the Vite-built React/shadcn dashboard from dashboard/dist/.
 * Provides REST API endpoints for task management.
 */

import { existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import type { Task } from "../types/index.js";
import type { RouteContext, FilteredClient } from "./routes.js";
import {
  containHostedDatastoreSurface,
  hostedReadinessResponse,
} from "./hosted-authority.js";
import {
  assertTodosLocalStorageRole,
  readStageADataProperty,
  resolveTodosStorageRole,
  snapshotTodosStorageEnvironment,
  TodosHostedStorageUnavailableError,
  type TodosStorageRoleResolution,
} from "../storage/config.js";
import { classifyTodosServerPostContainmentDispatch } from "./stage-a-dispatch.js";

// Resolve the dashboard dist directory — check multiple locations
function resolveDashboardDir(): string {
  const candidates: string[] = [];

  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(scriptDir, "..", "dashboard", "dist"));
    candidates.push(join(scriptDir, "..", "..", "dashboard", "dist"));
  } catch {
    // import.meta.url may not resolve in all contexts
  }

  if (process.argv[1]) {
    const mainDir = dirname(process.argv[1]);
    candidates.push(join(mainDir, "..", "dashboard", "dist"));
    candidates.push(join(mainDir, "..", "..", "dashboard", "dist"));
  }

  candidates.push(join(process.cwd(), "dashboard", "dist"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return join(process.cwd(), "dashboard", "dist");
}

export const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0", // Modern browsers ignore this, but safe to send
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=, microphone=, geolocation=",
};

function getProvidedApiKey(req: Request): string | null {
  const headerKey = req.headers.get("x-api-key");
  if (headerKey) return headerKey.trim();
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  return auth.replace(/^Bearer\s+/i, "").trim() || null;
}

/** Check API key auth — returns a Response if unauthorized, null if OK */
interface ApiKeyDependencies {
  hasActiveApiKeys(): boolean;
  verifyApiKey(value: string): unknown;
  safeEqualStrings(left: string, right: string): boolean;
}

function checkAuth(
  req: Request,
  apiKey: string | null,
  dependencies: ApiKeyDependencies,
): Response | null {
  const generatedKeysEnabled = dependencies.hasActiveApiKeys();
  if (!apiKey && !generatedKeysEnabled) return null; // no key configured, skip auth

  const provided = getProvidedApiKey(req);
  // Constant-time compare for the static env/CLI key — avoids a timing oracle
  // that a plain `===` short-circuit would expose.
  const matchesEnvKey = Boolean(apiKey && provided && dependencies.safeEqualStrings(provided, apiKey));
  const matchesGeneratedKey = Boolean(provided && dependencies.verifyApiKey(provided));
  if (!matchesEnvKey && !matchesGeneratedKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": "Bearer", ...SECURITY_HEADERS },
    });
  }
  return null;
}

/** Simple in-memory rate limiter — tracks requests per IP per window. */
type RateLimitMap = Map<string, { count: number; resetAt: number }>;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_RATE_LIMIT_MAX = 120;

/**
 * Resolve the rate-limit bucket key for a request.
 *
 * By default we key on the real transport peer address (`server.requestIP`),
 * because Bun.serve never populates `x-forwarded-for` / `x-real-ip` for direct
 * connections — trusting those headers by default lets any client bypass the
 * limiter by rotating a spoofed XFF, while every genuine direct client collapses
 * into a single "unknown" bucket (self-DoS). Client headers are only honored
 * when the operator explicitly opts in via TODOS_TRUST_PROXY (i.e. the server
 * actually sits behind a trusted reverse proxy that sets them).
 */
export function resolveClientIp(
  req: Request,
  server: { requestIP(req: Request): { address: string } | null },
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")?.trim();
    if (forwarded) return forwarded;
  }
  return server.requestIP(req)?.address || "unknown";
}

function checkRateLimit(
  rateLimitMap: RateLimitMap,
  ip: string,
  max = DEFAULT_RATE_LIMIT_MAX,
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  entry.count++;
  if (entry.count > max) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true };
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...SECURITY_HEADERS,
      ...(headers || {}),
    },
  });
}

export function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(Bun.file(filePath), {
    headers: {
      "Content-Type": contentType,
      ...SECURITY_HEADERS,
    },
  });
}

export function taskToSummary(task: Task, fields?: string[]) {
  const full = {
    id: task.id,
    short_id: task.short_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    project_id: task.project_id,
    plan_id: task.plan_id,
    task_list_id: task.task_list_id,
    agent_id: task.agent_id,
    assigned_to: task.assigned_to,
    working_dir: task.working_dir,
    locked_by: task.locked_by,
    tags: task.tags,
    metadata: task.metadata,
    version: task.version,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
    due_at: task.due_at,
    recurrence_rule: task.recurrence_rule,
  };
  if (!fields || fields.length === 0) return full;
  return Object.fromEntries(fields.map(f => [f, (full as Record<string, unknown>)[f] ?? null]));
}

export interface StartServerOptions {
  open?: boolean;
  host?: string;
  apiKey?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface ResolvedStartServerOptions {
  shouldOpen: boolean;
  hostname: string;
  apiKey: string | null;
  trustProxy: boolean;
  environment: NodeJS.ProcessEnv;
  storageRole: TodosStorageRoleResolution;
}

function trustProxyFromEnvironment(environment: NodeJS.ProcessEnv): boolean {
  const value = environment.TODOS_TRUST_PROXY?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/** Resolve process role before touching caller-owned options. */
export function resolveStartServerOptions(
  options?: StartServerOptions,
): ResolvedStartServerOptions {
  const processEnvironment = snapshotTodosStorageEnvironment(process.env);
  const processRole = resolveTodosStorageRole(processEnvironment);
  if (processRole.role !== "local") {
    return Object.freeze({
      shouldOpen: false,
      hostname: "127.0.0.1",
      apiKey: null,
      trustProxy: trustProxyFromEnvironment(processEnvironment),
      environment: processEnvironment,
      storageRole: processRole,
    });
  }

  if (!options) {
    return Object.freeze({
      shouldOpen: true,
      hostname: "127.0.0.1",
      apiKey: processEnvironment.TODOS_API_KEY || null,
      trustProxy: trustProxyFromEnvironment(processEnvironment),
      environment: processEnvironment,
      storageRole: processRole,
    });
  }

  const suppliedEnvironment = readStageADataProperty(options, "environment");
  if (
    suppliedEnvironment !== undefined &&
    (suppliedEnvironment === null || typeof suppliedEnvironment !== "object")
  ) {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  const environment = suppliedEnvironment === undefined
    ? processEnvironment
    : snapshotTodosStorageEnvironment(suppliedEnvironment);
  const storageRole = resolveTodosStorageRole(environment);
  if (storageRole.role !== "local") {
    return Object.freeze({
      shouldOpen: false,
      hostname: "127.0.0.1",
      apiKey: null,
      trustProxy: trustProxyFromEnvironment(environment),
      environment,
      storageRole,
    });
  }

  const open = readStageADataProperty(options, "open");
  const host = readStageADataProperty(options, "host");
  const explicitApiKey = readStageADataProperty(options, "apiKey");
  if (open !== undefined && typeof open !== "boolean") {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  if (host !== undefined && typeof host !== "string") {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  if (explicitApiKey !== undefined && typeof explicitApiKey !== "string") {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  return Object.freeze({
    shouldOpen: open ?? true,
    hostname: host || "127.0.0.1",
    apiKey: explicitApiKey || environment.TODOS_API_KEY || null,
    trustProxy: trustProxyFromEnvironment(environment),
    environment,
    storageRole,
  });
}

export async function startServer(port: number, options?: StartServerOptions): Promise<void> {
  const {
    shouldOpen,
    hostname,
    apiKey,
    trustProxy,
    environment,
    storageRole: initialStorageRole,
  } = resolveStartServerOptions(options);

  // Process authority is the startup floor, including for callers that import
  // this module directly. Hosted or invalid intent must reject before route or
  // database imports, dashboard probing, listener setup, sockets, CORS/rate
  // state, or Bun.serve. Because startServer is async, this remains a rejected
  // Promise rather than a synchronous throw for public API compatibility.
  if (initialStorageRole.role !== "local") {
    throw new TodosHostedStorageUnavailableError(initialStorageRole.reason);
  }

  let handlers: typeof import("./routes.js") | null = null;
  let apiKeyDependencies: ApiKeyDependencies | null = null;

  // Local/self-hosted mode is explicit. A remote service must not initialize
  // SQLite or its shadow drain before hosted authority is available.
  if (initialStorageRole.role === "local") {
    const [databaseModule, routesModule, apiKeyModule] = await Promise.all([
      import("../db/database.js"),
      import("./routes.js"),
      import("../db/api-keys.js"),
    ]);
    handlers = routesModule;
    apiKeyDependencies = apiKeyModule;
    const { getDatabase } = databaseModule;
    const db = getDatabase(undefined, environment);
    try {
      const { startRuntimeShadowDrain } = await import("../storage/shadow-runtime.js");
      assertTodosLocalStorageRole(process.env);
      assertTodosLocalStorageRole(environment);
      startRuntimeShadowDrain(db, environment);
    } catch (error) {
      if (error instanceof TodosHostedStorageUnavailableError) throw error;
      /* shadow disabled or unavailable — local writes stay durable */
    }
  }

  // Per-listener mutable state is allocated only after local authority and the
  // authorized dependency graph are established.
  const rateLimitMap: RateLimitMap = new Map();

  // SSE event stream — clients subscribe to /api/events
  const sseClients = new Set<ReadableStreamDefaultController>();

  // Filtered SSE clients for /api/tasks/stream
  const filteredSseClients = new Set<FilteredClient>();

  function broadcastEvent(event: { type: string; task_id?: string; action: string; agent_id?: string | null; project_id?: string | null }) {
    const data = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
    const eventName = `task.${event.action}`;
    // Broadcast to dashboard clients — collect dead clients first, delete after iteration
    const deadClients: ReadableStreamDefaultController[] = [];
    for (const controller of sseClients) {
      try { controller.enqueue(`data: ${data}\n\n`); }
      catch { deadClients.push(controller); }
    }
    for (const controller of deadClients) sseClients.delete(controller);
    // Broadcast to filtered agent stream clients
    const deadFiltered: FilteredClient[] = [];
    for (const client of filteredSseClients) {
      if (client.events && !client.events.has(eventName) && !client.events.has("*")) continue;
      if (client.agentId && event.agent_id !== client.agentId) continue;
      if (client.projectId && event.project_id !== client.projectId) continue;
      try { client.controller.enqueue(`event: ${eventName}\ndata: ${data}\n\n`); }
      catch { deadFiltered.push(client); }
    }
    for (const client of deadFiltered) filteredSseClients.delete(client);
  }

  const dashboardDir = initialStorageRole.role === "local" ? resolveDashboardDir() : "";
  const dashboardExists = initialStorageRole.role === "local" && existsSync(dashboardDir);

  if (initialStorageRole.role === "local" && !dashboardExists) {
    console.error(`\nDashboard not found at: ${dashboardDir}`);
    console.error(`Run this to build it:\n`);
    console.error(`  cd dashboard && bun install && bun run build\n`);
  }

  // Route context passed to all handlers
  const ctx: RouteContext = {
    port,
    sseClients,
    filteredSseClients,
    broadcastEvent,
    dashboardExists,
    dashboardDir,
    apiKey,
  };

  assertTodosLocalStorageRole(process.env);
  assertTodosLocalStorageRole(environment);
  const server = Bun.serve({
    port,
    hostname,
    async fetch(req, server) {
      // Unified authority floor: this is deliberately the first request action.
      // It precedes URL/header/CORS parsing, rate history, dynamic imports,
      // authentication, body reads, and every datastore dependency.
      const hostedContainment = await containHostedDatastoreSurface(req, environment);
      if (hostedContainment) return hostedContainment;

      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;
      const dispatchFamily = classifyTodosServerPostContainmentDispatch(method, path);

      // Unknown sensitive paths and unsupported methods terminate before
      // request headers, rate state, auth, transports, or datastore handlers.
      if (dispatchFamily === "sensitive-not-found") {
        return json({ error: "Not found", code: "ROUTE_NOT_FOUND" }, 404);
      }
      if (dispatchFamily === "sensitive-method-not-allowed") {
        return json({ error: "method_not_allowed", code: "METHOD_NOT_ALLOWED" }, 405);
      }

      const reqOrigin = req.headers.get("origin") || undefined;
      const corsHeaders = reqOrigin && (reqOrigin === `http://localhost:${port}` || reqOrigin === "http://localhost:0")
        ? {
            "Access-Control-Allow-Origin": reqOrigin,
            "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
            "Vary": "Origin",
          }
        : undefined;

      const jsonWithCors = (data: unknown, status = 200) => json(data, status, corsHeaders);

      // ── CORS preflight (no state change, no auth) ──
      if (dispatchFamily === "generic-options") {
        return new Response(null, {
          headers: corsHeaders || {
            "Vary": "Origin",
          },
        });
      }

      // ── Rate limiting (ALL requests, including /mcp and /health) ──
      // Keyed on the real socket peer, not spoofable client headers.
      const ip = resolveClientIp(req, server, trustProxy);
      const configuredRateLimit = Number(environment["TODOS_RATE_LIMIT_MAX"] ?? DEFAULT_RATE_LIMIT_MAX);
      const rateLimitMax = Number.isSafeInteger(configuredRateLimit) && configuredRateLimit > 0
        ? configuredRateLimit
        : DEFAULT_RATE_LIMIT_MAX;
      const rl = checkRateLimit(rateLimitMap, ip, rateLimitMax);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ error: "Too many requests", retry_after: rl.retryAfter }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": String(rl.retryAfter ?? 60), ...SECURITY_HEADERS },
        });
      }

      // ── Service surface probes (unauthenticated): /health /ready /version ──
      if (dispatchFamily === "service-probe") {
        const { getPackageVersion } = await import("../lib/package-version.js");
        const mode = resolveTodosStorageRole(environment).role === "local" ? "local" : "remote";
        const version = getPackageVersion();
        if (path === "/version") {
          return Response.json({ status: "ok", version, mode, name: "todos" });
        }
        if (path === "/ready") {
          if (mode === "remote") {
            return hostedReadinessResponse(version, mode);
          }
          return Response.json({ status: "ready", version, mode });
        }
        return Response.json({ status: "ok", version, mode, name: "todos" });
      }

      // ── OpenAPI document (unauthenticated; source of truth for the SDK) ──
      if (dispatchFamily === "openapi-probe") {
        const { buildV1OpenApiDocument } = await import("./openapi.js");
        return Response.json(buildV1OpenApiDocument());
      }

      // ── Versioned cloud API (/v1/*): A1 pure-remote, self-authenticating ──
      if (dispatchFamily === "v1-dispatch") {
        const { handleV1Request } = await import("./v1.js");
        const res = await handleV1Request(req, url, { environment });
        if (res) return res;
      }

      // A hosted process intentionally did not import local routes, API-key
      // storage, or SQLite. Only the explicit probes above survive Stage A.
      if (!handlers || !apiKeyDependencies) {
        return json({ error: "Not Found" }, 404);
      }

      // ── MCP Streamable HTTP (shared long-lived server) ──
      // Gated by the SAME auth check as /api/* — otherwise the MCP transport is
      // an unauthenticated create/update/delete backdoor around the REST auth.
      if (dispatchFamily === "mcp-runtime") {
        const authError = checkAuth(req, apiKey, apiKeyDependencies);
        if (authError) return authError;
        const { handleMcpHttpRequest } = await import("../mcp/http.js");
        return handleMcpHttpRequest(req);
      }

      // ── API key auth (all /api/* routes) ──
      if (path.startsWith("/api/")) {
        const authError = checkAuth(req, apiKey, apiKeyDependencies);
        if (authError) return authError;
      }

      // ── SSE Event Stream (supports optional agent_id/project_id filtering) ──
      if (path === "/api/events" && method === "GET") {
        const res = handlers.handleSseEvents(req, url, ctx);
        if (res) return res;
      }

      // ── SSE Agent Task Stream ──
      if (path === "/api/tasks/stream" && method === "GET") {
        const res = handlers.handleTasksStream(req, url, ctx);
        if (res) return res;
      }

      // ── API: Health ──
      if (path === "/api/health" && method === "GET") {
        return handlers.handleHealth(ctx, json);
      }

      // ── API: Headless boundary manifest (agent-native, local-only) ──
      if (path === "/api/headless" && method === "GET") {
        return handlers.handleHeadlessBoundary(ctx, json);
      }

      // ── API: Stats ──
      if (path === "/api/stats" && method === "GET") {
        return handlers.handleStats(ctx, json);
      }

      // ── API: List tasks ──
      if (path === "/api/tasks" && method === "GET") {
        return handlers.handleListTasks(req, url, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Create task ──
      if (path === "/api/tasks" && method === "POST") {
        return handlers.handleCreateTask(req, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Upsert task by fingerprint ──
      if (path === "/api/tasks/upsert" && method === "POST") {
        return handlers.handleUpsertTask(req, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Export tasks ──
      if (path === "/api/tasks/export" && method === "GET") {
        return handlers.handleTasksExport(req, url, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Bulk operations ──
      if (path === "/api/tasks/bulk" && method === "POST") {
        return handlers.handleTasksBulk(req, ctx, json);
      }

      // ── API: Task status summary ──
      if (path === "/api/tasks/status" && method === "GET") {
        return handlers.handleTasksStatus(req, url, ctx, json);
      }

      // ── API: Next task ──
      if (path === "/api/tasks/next" && method === "GET") {
        return handlers.handleTasksNext(req, url, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Active work ──
      if (path === "/api/tasks/active" && method === "GET") {
        return handlers.handleTasksActive(req, url, ctx, json);
      }

      // ── API: Stale tasks ──
      if (path === "/api/tasks/stale" && method === "GET") {
        return handlers.handleTasksStale(req, url, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Changed tasks ──
      if (path === "/api/tasks/changed" && method === "GET") {
        return handlers.handleTasksChanged(req, url, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Task Context (for agent prompt injection) ──
      if (path === "/api/tasks/context" && method === "GET") {
        return handlers.handleTasksContext(req, url, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Task attachments ──
      const attachmentsMatch = path.match(/^\/api\/tasks\/([^/]+)\/attachments$/);
      if (attachmentsMatch && method === "GET") {
        return handlers.handleTaskAttachments(attachmentsMatch[1]!, ctx, json);
      }

      // ── API: Single task operations ──
      // /api/tasks/:id/progress — GET (read) and POST (log)
      const progressMatch = path.match(/^\/api\/tasks\/([^/]+)\/progress$/);
      if (progressMatch) {
        const res = await handlers.handleTaskProgress(progressMatch[1]!, req, method, ctx, json, url);
        if (res !== null) return res;
      }

      const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const id = taskMatch[1]!;

        // GET /api/tasks/:id
        if (method === "GET") {
          return handlers.handleGetTask(id, ctx, jsonWithCors, taskToSummary, url);
        }

        // PATCH /api/tasks/:id
        if (method === "PATCH") {
          return handlers.handlePatchTask(id, req, ctx, jsonWithCors, taskToSummary);
        }

        // DELETE /api/tasks/:id
        if (method === "DELETE") {
          return handlers.handleDeleteTask(id, ctx, json);
        }
      }

      // ── API: Start task ──
      const startMatch = path.match(/^\/api\/tasks\/([^/]+)\/start$/);
      if (startMatch && method === "POST") {
        return handlers.handleStartTask(startMatch[1]!, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Fail task ──
      const failMatch = path.match(/^\/api\/tasks\/([^/]+)\/fail$/);
      if (failMatch && method === "POST") {
        return handlers.handleFailTask(failMatch[1]!, req, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Complete task ──
      const completeMatch = path.match(/^\/api\/tasks\/([^/]+)\/complete$/);
      if (completeMatch && method === "POST") {
        return handlers.handleCompleteTask(completeMatch[1]!, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Projects ──
      if (path === "/api/projects" && method === "GET") {
        return handlers.handleListProjects(url, ctx, json);
      }

      // ── API: Agent discovery ──
      if (path === "/api/agents/me" && method === "GET") {
        return handlers.handleAgentMe(req, url, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Agent task queue ──
      const queueMatch = path.match(/^\/api\/agents\/([^/]+)\/queue$/);
      if (queueMatch && method === "GET") {
        return handlers.handleAgentQueue(decodeURIComponent(queueMatch[1]!), ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Claim next task ──
      if (path === "/api/tasks/claim" && method === "POST") {
        return handlers.handleClaimTask(req, ctx, jsonWithCors, taskToSummary);
      }

      // ── API: Orgs ──
      if (path === "/api/orgs" && method === "GET") {
        return handlers.handleListOrgs(ctx, json);
      }
      if (path === "/api/orgs" && method === "POST") {
        return handlers.handleCreateOrg(req, ctx, json);
      }
      const orgMatch = path.match(/^\/api\/orgs\/([^/]+)$/);
      if (orgMatch && method === "PATCH") {
        return handlers.handleUpdateOrg(orgMatch[1]!, req, ctx, json);
      }
      if (orgMatch && method === "DELETE") {
        return handlers.handleDeleteOrg(orgMatch[1]!, ctx, json);
      }

      // ── API: Org chart ──
      if (path === "/api/org" && method === "GET") {
        return handlers.handleOrgChart(ctx, json);
      }

      // ── API: Agent team (direct reports) ──
      const teamMatch = path.match(/^\/api\/agents\/([^/]+)\/team$/);
      if (teamMatch && method === "GET") {
        return handlers.handleAgentTeam(teamMatch[1]!, ctx, json);
      }

      // ── API: Agents ──
      if (path === "/api/agents" && method === "GET") {
        return handlers.handleListAgents(url, ctx, json);
      }

      // ── API: Create project ──
      if (path === "/api/projects" && method === "POST") {
        return handlers.handleCreateProject(req, ctx, json);
      }

      // ── API: Delete project ──
      const projectDeleteMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      if (projectDeleteMatch && method === "DELETE") {
        return handlers.handleDeleteProject(projectDeleteMatch[1]!, ctx, json);
      }

      // ── API: Register agent ──
      if (path === "/api/agents" && method === "POST") {
        return handlers.handleRegisterAgent(req, ctx, json);
      }

      // ── API: Update/Delete agent ──
      const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
      if (agentMatch && method === "PATCH") {
        return handlers.handleUpdateAgent(agentMatch[1]!, req, ctx, json);
      }
      if (agentMatch && method === "DELETE") {
        return handlers.handleDeleteAgent(agentMatch[1]!, ctx, json);
      }

      // ── API: Bulk delete agents ──
      if (path === "/api/agents/bulk" && method === "POST") {
        return handlers.handleBulkDeleteAgents(req, ctx, json);
      }

      // ── API: Bulk delete projects ──
      if (path === "/api/projects/bulk" && method === "POST") {
        return handlers.handleBulkDeleteProjects(req, ctx, json);
      }

      // ── API: Doctor ──
      if (path === "/api/doctor" && method === "GET") {
        return handlers.handleDoctor(ctx, json);
      }

      // ── API: Report ──
      if (path === "/api/report" && method === "GET") {
        return handlers.handleReport(req, url, ctx, json);
      }

      if (path === "/api/activity" && method === "GET") {
        return handlers.handleActivity(req, url, ctx, json);
      }

      // ── API: Task history ──
      const historyMatch = path.match(/^\/api\/tasks\/([^/]+)\/history$/);
      if (historyMatch && method === "GET") {
        return handlers.handleTaskHistory(historyMatch[1]!, ctx, json, url);
      }

      // ── API: Webhooks ──
      if (path === "/api/webhooks" && method === "GET") {
        return handlers.handleListWebhooks(ctx, json);
      }
      if (path === "/api/webhooks" && method === "POST") {
        return handlers.handleCreateWebhook(req, ctx, json);
      }
      const webhookMatch = path.match(/^\/api\/webhooks\/([^/]+)$/);
      if (webhookMatch && method === "DELETE") {
        return handlers.handleDeleteWebhook(webhookMatch[1]!, ctx, json);
      }

      // ── API: Templates ──
      if (path === "/api/templates" && method === "GET") {
        return handlers.handleListTemplates(ctx, json);
      }
      if (path === "/api/templates" && method === "POST") {
        return handlers.handleCreateTemplate(req, ctx, json);
      }
      const templateMatch = path.match(/^\/api\/templates\/([^/]+)$/);
      if (templateMatch && method === "DELETE") {
        return handlers.handleDeleteTemplate(templateMatch[1]!, ctx, json);
      }

      // ── API: List plans ──
      if (path === "/api/plans" && method === "GET") {
        return handlers.handleListPlans(url, ctx, json);
      }

      // ── API: Create plan ──
      if (path === "/api/plans" && method === "POST") {
        return handlers.handleCreatePlan(req, ctx, json);
      }

      // ── API: Bulk delete plans ──
      if (path === "/api/plans/bulk" && method === "POST") {
        return handlers.handleBulkDeletePlans(req, ctx, json);
      }

      // ── API: Single plan operations ──
      const planMatch = path.match(/^\/api\/plans\/([^/]+)$/);
      if (planMatch) {
        const id = planMatch[1]!;

        if (method === "GET") {
          return handlers.handleGetPlan(id, ctx, jsonWithCors, taskToSummary);
        }

        if (method === "PATCH") {
          return handlers.handleUpdatePlan(id, req, ctx, json);
        }

        if (method === "DELETE") {
          return handlers.handleDeletePlan(id, ctx, json);
        }
      }

      // ── Static Files (Vite dashboard) ──
      const staticRes = handlers.handleStaticFiles(path, method, ctx, jsonWithCors, serveStaticFile);
      if (staticRes) return staticRes;

      return json({ error: "Not found" }, 404);
    },
  });

  // Graceful shutdown
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const serverUrl = `http://localhost:${port}`;
  console.log(`Todos Dashboard running at ${serverUrl}`);

  if (shouldOpen) {
    try {
      const { exec } = await import("child_process");
      const openCmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
      exec(`${openCmd} ${serverUrl}`);
    } catch {
      // Silently ignore if we can't open browser
    }
  }
}
