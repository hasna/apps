import { Hono } from "hono";
import type { Context } from "hono";
import { authenticateApiRequest, isApiAuthConfigured, type ApiPrincipal } from "./auth.js";
import { openDatabase } from "../db/database.js";
import { contextFromPrincipal, localOwnerContext } from "../services/context.js";
import { OPS, coerceField, type OpDef } from "../services/registry.js";
import { normalizeError, httpStatusForCode } from "../core/errors.js";
import { healthPayload, readyPayload, versionPayload } from "./health.js";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;

function rateLimitMax(): number {
  return Number.parseInt(process.env["HASNA_TREASURY_RATE_LIMIT"] || process.env["TREASURY_RATE_LIMIT"] || "120", 10);
}

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= rateLimitMax();
}

export function resetRateLimit(): void {
  rateLimitMap.clear();
}

/** Deny-by-default CORS: only explicitly-allowlisted origins, never `*` with credentials. */
function corsOrigins(): string[] {
  const raw = process.env["HASNA_TREASURY_CORS_ORIGINS"] || process.env["TREASURY_CORS_ORIGINS"] || "";
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export function getBindHost(): string {
  return process.env["HASNA_TREASURY_BIND_HOST"] || process.env["TREASURY_BIND_HOST"] || "127.0.0.1";
}

export function isLoopback(host = getBindHost()): boolean {
  return host === "127.0.0.1" || host === "localhost";
}

/**
 * Derive the rate-limit key from the CONNECTION, not the client-controllable
 * `X-Forwarded-For` header. Preference order:
 *   1. the real socket peer (Bun `server.requestIP`) — unspoofable by the client;
 *   2. the RIGHTMOST `X-Forwarded-For` hop (appended by the trusted proxy),
 *      never the leftmost client-supplied entry;
 *   3. a single connection bucket as a last resort.
 * This defeats the X-Forwarded-For rotation/spoofing bypass of the per-IP limit
 * on the unauthenticated auth surface.
 */
export function clientIp(c: Context): string {
  const server = c.env as { requestIP?: (req: Request) => { address?: string } | null } | undefined;
  const peer = server?.requestIP?.(c.req.raw)?.address;
  if (peer) return peer;
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return `xff:${hops[hops.length - 1]}`;
  }
  return "conn";
}

function buildInput(op: OpDef, c: Context, body: Record<string, unknown>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const f of op.fields) {
    let raw: unknown;
    if (f.location === "path") raw = c.req.param(f.name);
    else if (f.location === "query") raw = c.req.query(f.name);
    else raw = body[f.name];
    const v = coerceField(f, raw);
    if (v !== undefined) input[f.name] = v;
  }
  return input;
}

function honoPath(op: OpDef): string {
  return op.http.path; // Hono uses :param syntax already
}

export function createApp(): Hono {
  const app = new Hono();

  // CORS (deny-by-default) + rate limit middleware.
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    const allowed = corsOrigins();
    if (origin && allowed.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    const ip = clientIp(c);
    if (!checkRateLimit(ip)) {
      return c.json({ code: "RATE_LIMITED", message: "Too many requests", suggestion: "Slow down and retry." }, 429);
    }
    await next();
  });

  // System endpoints (§6.2).
  app.get("/health", (c) => c.json(healthPayload()));
  app.get("/version", (c) => c.json(versionPayload()));
  app.get("/ready", async (c) => {
    const { ok, body } = await readyPayload();
    return c.json(body, ok ? 200 : 503);
  });

  // /v1 domain routes generated from the shared op registry (interface parity).
  for (const op of OPS) {
    const handler = async (c: Context) => {
      const authConfigured = isApiAuthConfigured();
      let principal: ApiPrincipal | null = null;
      if (authConfigured) {
        principal = authenticateApiRequest(c.req.raw);
        if (!principal) {
          return c.json({ code: "UNAUTHORIZED", message: "Invalid or missing API credential.", suggestion: "Provide a valid Bearer token." }, 401);
        }
      }
      let body: Record<string, unknown> = {};
      if (op.http.method === "POST" || op.http.method === "PATCH") {
        try {
          body = (await c.req.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
      try {
        const db = await openDatabase();
        // Auth decoupled from mode: unauthenticated /v1 only when NOT configured
        // (startup guard already forbids that on non-loopback / cloud).
        const rc = principal ? contextFromPrincipal(db, principal) : localOwnerContext(db);
        const result = await op.run(rc, buildInput(op, c, body));
        return c.json(result as object);
      } catch (error) {
        const env = normalizeError(error);
        return c.json(env, httpStatusForCode(env.code) as never);
      }
    };
    const path = honoPath(op);
    if (op.http.method === "GET") app.get(path, handler);
    else if (op.http.method === "POST") app.post(path, handler);
    else if (op.http.method === "PATCH") app.patch(path, handler);
    else if (op.http.method === "DELETE") app.delete(path, handler);
  }

  app.notFound((c) => c.json({ code: "NOT_FOUND", message: `No route: ${c.req.method} ${c.req.path}`, suggestion: "Check the API path." }, 404));
  return app;
}
