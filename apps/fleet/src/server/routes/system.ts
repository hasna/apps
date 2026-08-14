import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { health } from "../health.js";

// System endpoints (§6.2): exact { status, version, mode } shape for /health and
// /version; /ready gates on a live DB connection.
export function registerSystemRoutes<T extends { Variables: Record<string, unknown> }>(
  app: Hono<T>,
  getDb: () => Database,
  ready?: () => boolean,
): void {
  app.get("/health", (c) => c.json(health()));
  app.get("/version", (c) => c.json(health()));
  app.get("/ready", (c) => {
    const ok = ready ? ready() : defaultReady(getDb);
    return ok ? c.json({ status: "ready" }) : c.json({ status: "not_ready" }, 503);
  });
}

function defaultReady(getDb: () => Database): boolean {
  try {
    getDb().query("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}
