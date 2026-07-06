import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { defaultAdapters } from "../adapters/index.js";
import { getDatabase } from "../db/database.js";
import { health } from "./health.js";
import {
  authenticateApiRequest,
  isApiAuthConfigured,
  localOwnerPrincipal,
  type ApiPrincipal,
} from "./auth.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerV1Routes } from "./routes/v1.js";

type Variables = { principal: ApiPrincipal };

export interface AppOptions {
  bindHost?: string;
  db?: Database;
  ready?: () => boolean;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function parseOrigins(): string[] {
  const raw = process.env["HASNA_FLEET_CORS_ORIGINS"] || process.env["FLEET_CORS_ORIGINS"] || "";
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

// Simple in-memory fixed-window rate limiter (per client IP).
const RATE_LIMIT = 600;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

export function buildApp(options: AppOptions = {}): Hono<{ Variables: Variables }> {
  const bindHost = options.bindHost ?? "127.0.0.1";
  const mode = health().mode;
  // Auth is decoupled from storage mode: required whenever NOT (loopback AND local).
  const requireAuth = !(isLoopback(bindHost) && mode === "local");

  // Fail-closed: a non-loopback / cloud bind MUST have credentials configured.
  if (requireAuth && !isApiAuthConfigured()) {
    throw new Error(
      "[fleet] refusing to serve /v1 without credentials on a non-loopback or cloud bind. " +
        "Set HASNA_FLEET_API_CREDENTIALS (deny-by-default).",
    );
  }

  const app = new Hono<{ Variables: Variables }>();
  const allowedOrigins = parseOrigins();
  const adapters = defaultAdapters();
  const getDb = (): Database => options.db ?? getDatabase();

  // --- CORS (deny-by-default; never wildcard with credentials) ---
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && allowedOrigins.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      c.header("Access-Control-Allow-Headers", "Authorization,Content-Type");
      c.header("Access-Control-Allow-Credentials", "true");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  // --- rate limiter ---
  app.use("*", async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (rateLimited(ip)) {
      return c.json({ code: "RATE_LIMITED", message: "Too many requests.", suggestion: "Retry after a minute." }, 429);
    }
    await next();
  });

  registerSystemRoutes(app, getDb, options.ready);

  // --- /v1 auth middleware (deny-by-default) ---
  app.use("/v1/*", async (c, next) => {
    const principal = authenticateApiRequest(c.req.raw);
    if (requireAuth) {
      if (!principal) {
        return c.json({ code: "UNAUTHORIZED", message: "Invalid or missing bearer credential.", suggestion: "Send Authorization: Bearer <token>." }, 401);
      }
      c.set("principal", principal);
    } else {
      c.set("principal", principal ?? localOwnerPrincipal());
    }
    await next();
  });

  registerV1Routes(app, getDb, adapters);

  return app;
}
