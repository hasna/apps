import { Hono } from "hono";
import { healthPayload, readyPayload, versionPayload } from "./health.js";
import { checkRateLimit, corsOrigins } from "./request-auth.js";
import { registerV1Routes } from "./routes/v1.js";

// Hono app: deny-by-default CORS, rate limiting, system endpoints, and the
// generated /v1 surface.

function applyCors(res: Response, origin: string | undefined): void {
  if (!origin) return;
  const allowed = corsOrigins();
  // Deny-by-default: only echo an explicitly allowlisted origin. Never emit "*".
  if (allowed.includes(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Credentials", "true");
  }
}

export function createApp(): Hono {
  const app = new Hono();

  // CORS preflight (deny-by-default) + rate limiting.
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (c.req.method === "OPTIONS") {
      const res = new Response(null, { status: 204 });
      const allowed = corsOrigins();
      if (origin && allowed.includes(origin)) {
        res.headers.set("Access-Control-Allow-Origin", origin);
        res.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.headers.set("Access-Control-Allow-Credentials", "true");
        res.headers.set("Access-Control-Max-Age", "86400");
      }
      return res;
    }
    const ip = c.req.header("x-forwarded-for") || "local";
    const rate = checkRateLimit(ip);
    if (!rate.allowed) {
      return c.json({ code: "RATE_LIMITED", message: "Too many requests", suggestion: "Slow down and retry." }, 429);
    }
    await next();
    if (c.res) applyCors(c.res, origin);
  });

  // System endpoints (unauthenticated, contract-mandated shapes).
  app.get("/health", (c) => c.json(healthPayload()));
  app.get("/version", (c) => c.json(versionPayload()));
  app.get("/ready", async (c) => {
    const ready = await readyPayload();
    return ready.ready ? c.json({ status: "ready" }) : c.json({ status: "not-ready" }, 503);
  });

  registerV1Routes(app);

  app.notFound((c) => c.json({ code: "NOT_FOUND", message: `No route: ${c.req.method} ${c.req.path}`, suggestion: "Check the path and method." }, 404));
  return app;
}
