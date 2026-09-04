/**
 * HTTP server for the emails dashboard API and self-hosted /v1 service.
 * Serves the REST routes (/api, /track, /webhook, /open, /click); the static
 * browser dashboard was removed (tracker #1612), so unknown non-API routes
 * return a plain 404 instead of an SPA fallback.
 *
 * API route logic lives in api-routes.ts to keep this file thin.
 */

import { handleApiRequest } from "./api-routes.js";

const API_ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const API_ALLOWED_HEADERS = "Content-Type, Authorization";
const API_ALLOWED_HEADER_NAMES = new Set(["content-type", "authorization"]);
const UNSAFE_API_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface DashboardApiOriginAccess {
  allowed: boolean;
  origin?: string;
  reason?: string;
}

function configuredAllowedOrigins(): Set<string> {
  return new Set(
    (process.env["EMAILS_DASHBOARD_ALLOWED_ORIGINS"] ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function isTrustedDashboardHostname(hostname: string): boolean {
  const host = normalizedHostname(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function requestHostAllowed(requestUrl: URL, allowedOrigins: Set<string>): boolean {
  return isTrustedDashboardHostname(requestUrl.hostname) || allowedOrigins.has(requestUrl.origin);
}

export function isDashboardApiPath(path: string): boolean {
  return path.startsWith("/api/");
}

export function dashboardApiOriginAccess(req: Request, requestUrl: URL): DashboardApiOriginAccess {
  const allowedOrigins = configuredAllowedOrigins();
  if (!requestHostAllowed(requestUrl, allowedOrigins)) {
    return { allowed: false, reason: "Dashboard API Host is not allowed." };
  }

  const origin = req.headers.get("Origin");
  if (!origin) {
    const fetchSite = req.headers.get("Sec-Fetch-Site")?.toLowerCase();
    if (fetchSite === "cross-site") {
      return { allowed: false, reason: "Cross-site browser requests to the dashboard API are not allowed." };
    }
    if (UNSAFE_API_METHODS.has(req.method.toUpperCase())) {
      return { allowed: false, reason: "Unsafe dashboard API requests require an Origin header." };
    }
    return { allowed: true };
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return { allowed: false, reason: "Invalid Origin header." };
  }

  if (originUrl.origin === requestUrl.origin) {
    return { allowed: true, origin: originUrl.origin };
  }

  if (allowedOrigins.has(originUrl.origin)) {
    return { allowed: true, origin: originUrl.origin };
  }

  return { allowed: false, reason: "Cross-origin dashboard API requests are not allowed." };
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("Vary");
  if (!existing) {
    headers.set("Vary", value);
    return;
  }
  const values = existing.split(",").map((part) => part.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) headers.set("Vary", `${existing}, ${value}`);
}

function requestedDashboardApiHeaders(req: Request): string {
  const requested = req.headers.get("Access-Control-Request-Headers");
  if (!requested) return API_ALLOWED_HEADERS;

  const allowed = requested
    .split(",")
    .map((header) => header.trim())
    .filter((header) => API_ALLOWED_HEADER_NAMES.has(header.toLowerCase()));

  return allowed.length ? allowed.join(", ") : API_ALLOWED_HEADERS;
}

function applyDashboardApiCorsHeaders(headers: Headers, access: DashboardApiOriginAccess, req: Request): void {
  if (!access.origin) return;
  headers.set("Access-Control-Allow-Origin", access.origin);
  headers.set("Access-Control-Allow-Methods", API_ALLOWED_METHODS);
  headers.set("Access-Control-Allow-Headers", requestedDashboardApiHeaders(req));
  appendVary(headers, "Origin");
}

export function dashboardApiForbiddenResponse(access: DashboardApiOriginAccess): Response {
  return new Response(JSON.stringify({ error: access.reason ?? "Dashboard API request not allowed." }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export function dashboardApiPreflightResponse(req: Request, requestUrl: URL): Response {
  const access = dashboardApiOriginAccess(req, requestUrl);
  if (!access.allowed) return dashboardApiForbiddenResponse(access);

  const headers = new Headers();
  applyDashboardApiCorsHeaders(headers, access, req);
  return new Response(null, { status: 204, headers });
}

export function withDashboardApiCors(response: Response, access: DashboardApiOriginAccess, req: Request): Response {
  const headers = new Headers(response.headers);
  applyDashboardApiCorsHeaders(headers, access, req);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleDashboardRequest(
  req: Request,
  socketAddress?: string | null,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // ─── Dashboard API CORS preflight ──────────────────────────────────────
  if (method === "OPTIONS") {
    if (isDashboardApiPath(path)) return dashboardApiPreflightResponse(req, url);
    return new Response(null, { status: 204 });
  }

  // ─── API ROUTES ────────────────────────────────────────────────────────
  if (path.startsWith("/api/") || path.startsWith("/track/") || path.startsWith("/webhook/") || path.startsWith("/open/") || path.startsWith("/click/")) {
    const apiOriginAccess = isDashboardApiPath(path) ? dashboardApiOriginAccess(req, url) : null;
    if (apiOriginAccess && !apiOriginAccess.allowed) return dashboardApiForbiddenResponse(apiOriginAccess);
    const apiResponse = await handleApiRequest(req, url, path, method, socketAddress);
    if (apiResponse !== null) {
      return apiOriginAccess ? withDashboardApiCors(apiResponse, apiOriginAccess, req) : apiResponse;
    }
  }

  // Static browser dashboard removed (tracker #1612 sweep): unknown non-API
  // routes return a plain 404 instead of an SPA fallback.
  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
}

export async function startServer(port = 3900, hostname = "127.0.0.1"): Promise<void> {
  // Safety: the dashboard /api/* routes are unauthenticated and assume a trusted
  // loopback caller. Refuse to bind a non-loopback interface (exposing them to
  // the LAN/internet) unless the operator explicitly opts in.
  const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  if (!isLoopback && process.env["EMAILS_ALLOW_REMOTE"] !== "1") {
    throw new Error(
      `Refusing to bind ${hostname}: the dashboard /api/* routes are unauthenticated. ` +
      `Set EMAILS_ALLOW_REMOTE=1 to override (put it behind an authenticating proxy / firewall first).`,
    );
  }

  const server = Bun.serve({
    port,
    hostname,
    fetch: (req, server) => handleDashboardRequest(req, server.requestIP(req)?.address),
  });

  console.log(`\nEmails API running at http://${hostname}:${server.port}`);
  console.log(`API available at http://${hostname}:${server.port}/api`);
  console.log(`Press Ctrl+C to stop\n`);
}
