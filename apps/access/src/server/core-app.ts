import { Hono } from "hono";
import { CORE_ROUTES } from "../client/routes.js";
import { CORE_POLICY } from "./core-policy.js";
import { withCoreTransaction, type CorePool } from "./core-store.js";
import { createCoreAuthenticator } from "./core-auth.js";
import { runOperation } from "./core-domain/registry.js";
import { AccessError, errorStatus, toErrorEnvelope } from "../types/index.js";
import { APP_VERSION } from "../version.js";
import { serializeOpenApiDocument } from "../api/index.js";

/** PostgreSQL-only core server. No local-storage transport can be selected here. */
export function buildCoreApp(pool: CorePool, env: Record<string, string | undefined> = process.env): Hono {
  const authenticate = createCoreAuthenticator(env);
  const app = new Hono();
  const origins = new Set((env.HASNA_ACCESS_CORS_ORIGINS ?? env.ACCESS_CORS_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean));
  const capacity = Number(env.HASNA_ACCESS_RATE_LIMIT ?? 120);
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("Invalid Access rate limit.");
  const buckets = new Map<string, { remaining: number; resetAt: number }>();
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && origins.has(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });
  app.use("/v1/*", async (c, next) => {
    // Peer comes from the server socket, never caller-controlled proxy headers.
    const peer = (c.env as { peer?: string } | undefined)?.peer ?? "local";
    const now = Date.now();
    let bucket = buckets.get(peer);
    if (!bucket || now >= bucket.resetAt) {
      if (buckets.size >= 10_000) {
        for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
        if (buckets.size >= 10_000 && !buckets.has(peer)) return c.json({ code: "RATE_LIMITED", message: "Too many requests." }, 429);
      }
      bucket = { remaining: capacity, resetAt: now + 60_000 };
      buckets.set(peer, bucket);
    }
    if (bucket.remaining-- <= 0) return c.json({ code: "RATE_LIMITED", message: "Too many requests." }, 429);
    await next();
  });
  app.get("/health", c => c.json({ status: "ok", version: APP_VERSION, backend: "postgresql" }));
  app.get("/version", c => c.json({ status: "ok", version: APP_VERSION, backend: "postgresql" }));
  app.get("/openapi.json", c => c.json(JSON.parse(serializeOpenApiDocument())));
  app.get("/ready", async c => {
    try {
      const connection = await pool.connect();
      try {
        const result = await connection.query("SELECT id FROM schema_migrations WHERE id = 1");
        if (result.rows.length !== 1) throw new Error("Schema missing");
      } finally { connection.release(); }
      return c.json({ status: "ready" });
    } catch { return c.json({ status: "unavailable" }, 503); }
  });
  for (const [operation, [method, path]] of Object.entries(CORE_ROUTES)) {
    app.on(method, `/v1${path}`, async c => {
      try {
        return await withCoreTransaction(pool, async () => {
          const principal = await authenticate(c.req.raw);
          if (!principal) return c.json({ code: "UNAUTHORIZED", message: "Invalid or missing API credential." }, 401);
          const policy = CORE_POLICY[operation]!;
          if (policy.scopes.some(scope => !principal.scopes?.includes(scope))) return c.json({ code: "PERMISSION_DENIED", message: "Credential lacks required scope." }, 403);
          const query = Object.fromEntries(new URL(c.req.url).searchParams);
          let body: Record<string, unknown> = {};
          if (method !== "GET" && method !== "DELETE") {
            try { body = await c.req.json(); } catch { return c.json({ code: "VALIDATION_ERROR", message: "Expected JSON object." }, 400); }
            if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ code: "VALIDATION_ERROR", message: "Expected JSON object." }, 400);
          }
          const input = { ...query, ...body, ...(path.includes(":id") ? { id: c.req.param("id") } : {}) };
          const result = await runOperation(operation, input, principal);
          return c.json(result as never, policy.status);
        });
      } catch (error) {
        // PostgreSQL diagnostics can contain values from rejected rows; never return them.
        if (!(error instanceof AccessError)) return c.json({ code: "INTERNAL_ERROR", message: "Access operation failed." }, 500);
        return c.json(toErrorEnvelope(error), errorStatus(error) as 400 | 401 | 403 | 404 | 409);
      }
    });
  }
  return app;
}
