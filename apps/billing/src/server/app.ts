import { Hono } from "hono";
import type { Context } from "hono";
import { getDatabase } from "../db/database.js";
import { resolveStorageMode } from "../config.js";
import { APP_VERSION } from "../version.js";
import { ERROR_STATUS, errorEnvelope } from "../types/index.js";
import { ALL_OPS } from "../services/registry.js";
import { makeContext, runOp } from "../services/context.js";
import { SYSTEM_AUTHORIZATION_CONTEXT } from "../services/authorization.js";
import {
  authenticateToken,
  bearerFromHeader,
  isApiAuthConfigured,
  type ApiPrincipal,
} from "./auth.js";
import { InvalidListQueryError, hasListQuery, listQueryResponse } from "./list-query.js";

/** Serve config (BUILD-SPEC §6.1/§6.3). */
export function getPort(): number {
  return parseInt(process.env["HASNA_BILLING_PORT"] || process.env["BILLING_PORT"] || "3487", 10);
}
export function getBindHost(): string {
  return process.env["HASNA_BILLING_BIND_HOST"] || "127.0.0.1";
}
function isLoopbackBind(): boolean {
  const host = getBindHost();
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}
function corsOrigins(): string[] {
  return (process.env["HASNA_BILLING_CORS_ORIGINS"] || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
function rateLimitMax(): number {
  return parseInt(process.env["HASNA_BILLING_RATE_LIMIT"] || "120", 10);
}

/**
 * Auth is DECOUPLED from storage mode (BUILD-SPEC §6.3). Require auth whenever
 * the server binds a non-loopback interface OR runs cloud mode OR credentials
 * are configured. Unauthenticated /v1 is permitted ONLY on a strict 127.0.0.1
 * bind in local mode with no creds. Startup fails closed otherwise.
 */
export function authRequired(): boolean {
  return !isLoopbackBind() || resolveStorageMode() === "cloud" || isApiAuthConfigured();
}

export function assertServeSafeToStart(): void {
  if ((!isLoopbackBind() || resolveStorageMode() === "cloud") && !isApiAuthConfigured()) {
    throw new Error(
      "Refusing to start: billing-serve is bound to a non-loopback interface or cloud mode without any API " +
        "credentials configured. Set HASNA_BILLING_API_CREDENTIALS (a JSON array of distinct scoped " +
        "credentials) — /v1 must not serve open on a shared interface (BUILD-SPEC §6.3, fail-closed).",
    );
  }
}

// ---- rate limiter --------------------------------------------------------
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;
function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const max = rateLimitMax();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: max - 1 };
  }
  entry.count += 1;
  const remaining = max - entry.count;
  return remaining < 0 ? { allowed: false, remaining: 0 } : { allowed: true, remaining };
}

/** Only honor X-Forwarded-For when explicitly told we sit behind a trusted proxy (ALB). */
function trustProxy(): boolean {
  return process.env["HASNA_BILLING_TRUST_PROXY"] === "1" || process.env["BILLING_TRUST_PROXY"] === "1";
}

/**
 * Derive a rate-limit identity that a client cannot trivially rotate.
 * Precedence:
 *  1. The authenticated credential_id (best key for money endpoints — an
 *     attacker cannot mint fresh buckets without more valid credentials).
 *  2. Behind a KNOWN trusted proxy only, the rightmost X-Forwarded-For entry
 *     (the address the trusted proxy observed) — the raw header is otherwise
 *     fully client-controlled and is deliberately ignored.
 *  3. The real socket peer address (Bun `server.requestIP`).
 *  4. "local" as a last resort (in-process test requests).
 */
function rateLimitKey(c: Context): string {
  const token = bearerFromHeader(c.req.header("Authorization"));
  if (token) {
    const principal = authenticateToken(token);
    if (principal) return `cred:${principal.credential_id}`;
  }
  if (trustProxy()) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) return `ip:${parts[parts.length - 1]}`;
    }
  }
  const server = c.env as { requestIP?: (r: Request) => { address?: string } | null } | undefined;
  const peer = server?.requestIP?.(c.req.raw);
  if (peer?.address) return `ip:${peer.address}`;
  return "local";
}

function inputFromContext(c: Context, method: string, body: unknown): Record<string, unknown> {
  const params = c.req.param() as Record<string, string>;
  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  const bodyObj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const base: Record<string, unknown> = method === "GET" ? { ...query, ...params } : { ...bodyObj, ...params };
  // Webhook ingest: accept the real Stripe-Signature request header, falling
  // back to a body `signature` field (keeps the CLI/MCP surfaces at parity).
  if (base["signature"] === undefined) {
    const sig = c.req.header("Stripe-Signature");
    if (sig) base["signature"] = sig;
  }
  return base;
}

/** Build the Hono app with all middleware + registry-generated /v1 routes. */
export function buildApp(): Hono {
  const app = new Hono();

  // CORS: deny-by-default. Only echo an explicitly allowlisted origin; never
  // emit `*` while accepting credentials (BUILD-SPEC §6.3a).
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    const allowed = corsOrigins();
    if (origin && allowed.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  // Rate limiter. Keyed on a non-forgeable identity (credential_id / trusted
  // peer), NOT the raw client-controlled X-Forwarded-For. System endpoints are
  // exempt so ALB health checks are never starved (BUILD-SPEC §6.3).
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/health" || path === "/ready" || path === "/version") return next();
    const rl = checkRateLimit(rateLimitKey(c));
    if (!rl.allowed) return c.json({ code: "RATE_LIMITED", message: "Too many requests", suggestion: "Slow down." }, 429);
    c.header("X-RateLimit-Remaining", String(rl.remaining));
    await next();
  });

  // System endpoints (BUILD-SPEC §6.2).
  app.get("/health", (c) => c.json({ status: "ok", version: APP_VERSION, mode: resolveStorageMode() }));
  app.get("/version", (c) => c.json({ status: "ok", version: APP_VERSION, mode: resolveStorageMode() }));
  app.get("/ready", (c) => {
    try {
      getDatabase();
      return c.json({ status: "ready" });
    } catch (e) {
      return c.json({ status: "not_ready", detail: e instanceof Error ? e.message : String(e) }, 503);
    }
  });

  for (const op of ALL_OPS) registerOpRoute(app, op);
  return app;
}

function registerOpRoute(app: Hono, op: (typeof ALL_OPS)[number]): void {
  const handler = async (c: Context) => {
    // Authenticate the caller (deny-by-default when auth is required).
    const token = bearerFromHeader(c.req.header("Authorization"));
    let principal: ApiPrincipal | { actor_id: string; roles: ["system"]; bypass: true } | null = authenticateToken(token);
    if (!principal) {
      if (authRequired()) {
        return c.json({ code: "UNAUTHORIZED", message: "Invalid or missing bearer credential.", suggestion: "Provide a valid Bearer token." }, 401);
      }
      principal = SYSTEM_AUTHORIZATION_CONTEXT as { actor_id: string; roles: ["system"]; bypass: true };
    }

    let body: unknown = undefined;
    if (op.method !== "GET") {
      try {
        body = await c.req.json();
      } catch {
        body = {};
      }
    }

    try {
      const ctx = makeContext(getDatabase(), principal);
      const input = inputFromContext(c, op.method, body);
      const result = await runOp(op, ctx, input);
      if (op.method === "GET" && Array.isArray(result)) {
        const url = new URL(c.req.url);
        if (hasListQuery(url)) {
          return c.json(listQueryResponse(url, result as object[], { default_sort: "created_at", allowed_sorts: ["created_at", "id", "status"] }) as object);
        }
      }
      return c.json(result as object, op.mutates && op.method === "POST" && op.path.split("/").length === 3 ? 201 : 200);
    } catch (error) {
      if (error instanceof InvalidListQueryError) {
        return c.json({ code: error.code, message: error.message, suggestion: "" }, 400);
      }
      const env = errorEnvelope(error);
      const status = ERROR_STATUS[env.code] ?? 500;
      return c.json(env, status as 400 | 401 | 403 | 404 | 422 | 500);
    }
  };

  const path = op.path;
  switch (op.method) {
    case "GET":
      app.get(path, handler);
      break;
    case "POST":
      app.post(path, handler);
      break;
    case "PATCH":
      app.patch(path, handler);
      break;
    case "DELETE":
      app.delete(path, handler);
      break;
  }
}
