import { Hono } from "hono";
import type { Context, Next } from "hono";
import { resolveStorageMode } from "../config.js";
import { SYSTEM_AUTHORIZATION_CONTEXT, type AuthorizationContext } from "../services/authorization.js";
import { toErrorEnvelope } from "../types/index.js";
import { authenticateApiRequest, isApiAuthConfigured, toAuthorizationContext, type ApiPrincipal } from "./auth.js";
import { healthPayload, readyPayload, versionPayload } from "./health.js";
import { registerMemberRoutes } from "./routes/members.js";
import { registerCapabilityRoutes } from "./routes/capabilities.js";
import { registerLifecycleRoutes } from "./routes/lifecycle.js";
import { registerAssignmentRoutes } from "./routes/assignments.js";
import { registerExportRoutes } from "./routes/exports.js";

export interface AppVariables {
  principal: ApiPrincipal | null;
  authCtx: AuthorizationContext;
}

export type AppContext = Context<{ Variables: AppVariables }>;

// ---- env getters ----

export function getPort(): number {
  return parseInt(process.env["HASNA_WORKFORCE_PORT"] || process.env["WORKFORCE_PORT"] || "3484", 10);
}

export function getBindHost(): string {
  return process.env["HASNA_WORKFORCE_BIND_HOST"] || process.env["WORKFORCE_BIND_HOST"] || "127.0.0.1";
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** CORS allowlist (deny-by-default): no origins allowed unless explicitly configured. */
export function getCorsOrigins(): string[] {
  const raw = process.env["HASNA_WORKFORCE_CORS_ORIGINS"] || process.env["WORKFORCE_CORS_ORIGINS"] || "";
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

/** Auth is decoupled from storage mode: required on any non-loopback bind or cloud mode. */
export function authRequired(): boolean {
  const nonLoopback = !isLoopback(getBindHost());
  let cloud = false;
  try {
    cloud = resolveStorageMode() === "cloud";
  } catch {
    cloud = false;
  }
  return nonLoopback || cloud || isApiAuthConfigured();
}

/** Fail-closed guard: a cloud/non-loopback deployment MUST configure credentials. */
export function assertServeSafety(): void {
  const nonLoopback = !isLoopback(getBindHost());
  let cloud = false;
  try {
    cloud = resolveStorageMode() === "cloud";
  } catch {
    cloud = false;
  }
  if ((nonLoopback || cloud) && !isApiAuthConfigured()) {
    throw new Error(
      "Refusing to serve /v1 without credentials on a cloud or non-loopback bind. " +
        "Configure HASNA_WORKFORCE_API_CREDENTIALS (deny-by-default).",
    );
  }
}

// ---- rate limiter ----

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;

function rateLimitMax(): number {
  return parseInt(process.env["HASNA_WORKFORCE_RATE_LIMIT"] || "240", 10);
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const max = rateLimitMax();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: max - 1 };
  }
  entry.count += 1;
  const remaining = max - entry.count;
  return remaining < 0 ? { allowed: false, remaining: 0 } : { allowed: true, remaining };
}

const SYSTEM_PATHS = new Set(["/health", "/ready", "/version"]);

export function buildApp(): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

  // Rate limiter.
  app.use("*", async (c: AppContext, next: Next) => {
    const ip = c.req.header("x-forwarded-for") || "local";
    const rl = checkRateLimit(ip);
    if (!rl.allowed) return c.json({ code: "RATE_LIMITED", message: "Too many requests", suggestion: "Retry after the rate-limit window." }, 429);
    await next();
    c.header("X-RateLimit-Remaining", String(rl.remaining));
  });

  // CORS (deny-by-default allowlist; never wildcard with credentials).
  app.use("*", async (c: AppContext, next: Next) => {
    const origin = c.req.header("Origin");
    const allowed = getCorsOrigins();
    if (origin && allowed.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      c.header("Access-Control-Allow-Credentials", "true");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  // System endpoints (unauthenticated, minimal).
  app.get("/health", (c) => c.json(healthPayload()));
  app.get("/version", (c) => c.json(versionPayload()));
  app.get("/ready", (c) => {
    const { payload, status } = readyPayload();
    return c.json(payload, status as 200 | 503);
  });

  // Auth middleware for everything else.
  app.use("*", async (c: AppContext, next: Next) => {
    if (SYSTEM_PATHS.has(new URL(c.req.url).pathname)) return next();
    if (!authRequired()) {
      c.set("principal", null);
      c.set("authCtx", SYSTEM_AUTHORIZATION_CONTEXT);
      return next();
    }
    const principal = authenticateApiRequest(c.req.raw);
    if (!principal) {
      return c.json({ code: "UNAUTHORIZED", message: "Invalid or missing API credential.", suggestion: "Provide a valid bearer token." }, 401);
    }
    c.set("principal", principal);
    c.set("authCtx", toAuthorizationContext(principal));
    return next();
  });

  const v1 = new Hono<{ Variables: AppVariables }>();
  registerMemberRoutes(v1);
  registerCapabilityRoutes(v1);
  registerLifecycleRoutes(v1);
  registerAssignmentRoutes(v1);
  registerExportRoutes(v1);
  app.route("/v1", v1);

  app.notFound((c) => c.json({ code: "NOT_FOUND", message: `No route: ${c.req.method} ${new URL(c.req.url).pathname}`, suggestion: "Check the OpenAPI document for valid routes." }, 404));

  app.onError((error, c) => {
    const envelope = toErrorEnvelope(error);
    return c.json(envelope, statusForCode(envelope.code) as 400 | 401 | 403 | 404 | 409 | 422 | 500);
  });

  return app;
}

export function statusForCode(code: string): number {
  const map: Record<string, number> = {
    VALIDATION_ERROR: 400,
    INVALID_LIST_QUERY: 400,
    UNAUTHORIZED: 401,
    PERMISSION_DENIED: 403,
    MEMBER_NOT_FOUND: 404,
    ASSIGNMENT_NOT_FOUND: 404,
    CAPABILITY_NOT_FOUND: 404,
    NOT_FOUND: 404,
    VERSION_CONFLICT: 409,
    INVALID_LIFECYCLE_TRANSITION: 422,
  };
  return map[code] ?? 500;
}
