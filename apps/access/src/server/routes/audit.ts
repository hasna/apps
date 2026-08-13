import type { Hono } from "hono";
import { collectInput, runRoute } from "./helpers.js";

export function registerAuditRoutes(app: Hono): void {
  app.get("/v1/audit", async (c) => runRoute(c, { op: "audit.list", scopes: ["access:read"], entityIdFrom: (i) => i.entity_id as string | undefined }, await collectInput(c)));
  app.get("/v1/audit/verify", async (c) => runRoute(c, { op: "audit.verify", scopes: ["access:read"] }, await collectInput(c)));
}
