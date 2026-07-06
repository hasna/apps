import { Hono } from "hono";
import { getConnInfo } from "hono/bun";
import type { Context } from "hono";
import type { AppEnv } from "./hono-env.js";
import type { Database } from "bun:sqlite";
import { resolveStorageMode, type StorageMode } from "../config.js";
import { authenticateBearer, bearerToken, isApiAuthConfigured } from "./auth.js";
import { healthPayload, readyResult, versionPayload } from "./health.js";
import { LOCAL_DEV_PRINCIPAL } from "./principal.js";
import { registerEntitiesRoutes } from "./routes/entities.js";
import { registerAssetsRoutes } from "./routes/assets.js";
import { registerRegistrationsRoutes } from "./routes/registrations.js";
import { registerRenewalsRoutes } from "./routes/renewals.js";
import { registerClassesRoutes } from "./routes/classes.js";
import { registerDocumentsRoutes } from "./routes/documents.js";

export interface AppDeps {
  db: Database;
  bindHost?: string;
  mode?: StorageMode;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Whether the server must require auth (§6.3): any non-loopback bind or cloud mode. */
export function authRequiredFor(bindHost: string, mode: StorageMode): boolean {
  return !isLoopback(bindHost) || mode === "cloud";
}

function corsOrigins(): string[] {
  const raw = process.env["HASNA_HOLDINGS_CORS_ORIGINS"] || process.env["HOLDINGS_CORS_ORIGINS"] || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Minimal in-memory fixed-window rate limiter (per client IP).
const RATE_LIMIT = Number(process.env["HASNA_HOLDINGS_RATE_LIMIT"] ?? "600");
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

/** Whether this deployment sits behind a trusted proxy/ALB that sets XFF. */
export function trustProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env["HASNA_HOLDINGS_TRUST_PROXY"] ?? env["HOLDINGS_TRUST_PROXY"] ?? "").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Rate-limit bucket key. By default we key on the actual socket peer so a hostile
 * client cannot bypass the limit by rotating `x-forwarded-for` (which is fully
 * client-controlled). The forwarded header is only trusted when the operator
 * opts in via HASNA_HOLDINGS_TRUST_PROXY, i.e. the app genuinely runs behind a known
 * proxy hop that overwrites XFF.
 */
export function rateLimitKey(c: Context<AppEnv>): string {
  if (trustProxy()) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return `xff:${xff.split(",")[0]!.trim()}`;
    const real = c.req.header("x-real-ip");
    if (real) return `xff:${real.trim()}`;
  }
  try {
    const info = getConnInfo(c);
    if (info.remote.address) return `peer:${info.remote.address}`;
  } catch {
    // No socket info available (e.g. in-process test client): fall through.
  }
  return "local";
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const bindHost = deps.bindHost ?? "127.0.0.1";
  const mode = deps.mode ?? resolveStorageMode();
  const authRequired = authRequiredFor(bindHost, mode);
  const allowedOrigins = corsOrigins();

  // Deny-by-default CORS (§6.3a): only reflect explicitly allowlisted origins;
  // never emit `*` alongside credentials.
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && allowedOrigins.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  // Rate limiter.
  app.use("*", async (c, next) => {
    const key = rateLimitKey(c);
    if (rateLimited(key)) {
      return c.json({ code: "RATE_LIMITED", message: "Too many requests.", suggestion: "Retry after the window resets." }, 429);
    }
    await next();
  });

  // System endpoints (§6.2).
  app.get("/health", (c) => c.json(healthPayload(mode)));
  app.get("/version", (c) => c.json(versionPayload(mode)));
  app.get("/ready", (c) => {
    const { ready, payload } = readyResult(deps.db);
    return c.json(payload, ready ? 200 : 503);
  });

  // Auth middleware for the whole /v1 surface (deny-by-default).
  app.use("/v1/*", async (c, next) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (token) {
      const principal = authenticateBearer(token);
      if (!principal) {
        return c.json({ code: "UNAUTHORIZED", message: "Invalid or missing API credential.", suggestion: "Provide a valid Bearer token." }, 401);
      }
      c.set("principal", principal);
    } else if (authRequired || isApiAuthConfigured()) {
      return c.json({ code: "UNAUTHORIZED", message: "Invalid or missing API credential.", suggestion: "Provide a valid Bearer token." }, 401);
    } else {
      // Loopback + local + no credentials configured: local-dev convenience only.
      c.set("principal", LOCAL_DEV_PRINCIPAL);
    }
    await next();
  });

  const routeDeps = { db: deps.db };
  registerEntitiesRoutes(app, routeDeps);
  registerAssetsRoutes(app, routeDeps);
  registerRegistrationsRoutes(app, routeDeps);
  registerRenewalsRoutes(app, routeDeps);
  registerClassesRoutes(app, routeDeps);
  registerDocumentsRoutes(app, routeDeps);

  return app;
}
