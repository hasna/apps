import { Hono } from "hono";
import { healthPayload, readyPayload, versionPayload } from "./health.js";
import { registerIdentityRoutes } from "./routes/identities.js";
import { registerCredentialRoutes } from "./routes/credentials.js";
import { registerScopeRoutes } from "./routes/scopes.js";
import { registerElevationRoutes } from "./routes/elevations.js";
import { registerReviewRoutes } from "./routes/reviews.js";
import { registerRequestRoutes } from "./routes/requests.js";
import { registerRevocationRoutes } from "./routes/revocations.js";
import { registerTokenRoutes } from "./routes/tokens.js";
import { registerAuditRoutes } from "./routes/audit.js";

/** CORS deny-by-default (§6.3a): no origin allowed unless explicitly listed. */
function corsOrigins(): Set<string> {
  const raw = process.env["HASNA_ACCESS_CORS_ORIGINS"] || process.env["ACCESS_CORS_ORIGINS"] || "";
  return new Set(raw.split(",").map((o) => o.trim()).filter(Boolean));
}

interface Bucket {
  tokens: number;
  updated: number;
}
const RATE_CAPACITY = Number.parseInt(process.env["HASNA_ACCESS_RATE_LIMIT"] || "120", 10);
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, Bucket>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: RATE_CAPACITY, updated: now };
  const refill = ((now - bucket.updated) / RATE_WINDOW_MS) * RATE_CAPACITY;
  bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + refill);
  bucket.updated = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return true;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return false;
}

export function buildApp(): Hono {
  const app = new Hono();

  // Deny-by-default CORS middleware.
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    const allowed = corsOrigins();
    if (origin && allowed.has(origin)) {
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
  app.use("/v1/*", async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (rateLimited(ip)) {
      return c.json({ code: "RATE_LIMITED", message: "Too many requests.", suggestion: "Slow down and retry shortly." }, 429);
    }
    await next();
  });

  // System endpoints (§6.2).
  app.get("/health", (c) => c.json(healthPayload()));
  app.get("/version", (c) => c.json(versionPayload()));
  app.get("/ready", (c) => {
    const ready = readyPayload();
    return c.json({ status: ready.ready ? "ready" : "unavailable", ...(ready.reason ? { reason: ready.reason } : {}) }, ready.ready ? 200 : 503);
  });

  // /v1 domain routers (deny-by-default, tenant scoped).
  registerIdentityRoutes(app);
  registerCredentialRoutes(app);
  registerScopeRoutes(app);
  registerElevationRoutes(app);
  registerReviewRoutes(app);
  registerRequestRoutes(app);
  registerRevocationRoutes(app);
  registerTokenRoutes(app);
  registerAuditRoutes(app);

  app.notFound((c) => c.json({ code: "NOT_FOUND", message: "No such route.", suggestion: "Check the path and method." }, 404));
  return app;
}
