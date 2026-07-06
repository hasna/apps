import type { Hono } from "hono";
import { collectInput, runRoute } from "./helpers.js";

export function registerTokenRoutes(app: Hono): void {
  app.get("/v1/tokens", async (c) => runRoute(c, { op: "token.list", scopes: ["access:read"], entityIdFrom: (i) => i.entity_id as string | undefined }, await collectInput(c)));
  app.post("/v1/tokens", async (c) => runRoute(c, { op: "token.issue", scopes: ["token:issue"], successStatus: 201 }, await collectInput(c)));
  app.post("/v1/tokens/verify", async (c) => runRoute(c, { op: "token.verify", scopes: ["access:read"] }, await collectInput(c)));
  app.get("/v1/tokens/:id", async (c) => runRoute(c, { op: "token.get", scopes: ["access:read"] }, await collectInput(c, { id: c.req.param("id") })));
  app.delete("/v1/tokens/:id", async (c) => runRoute(c, { op: "token.revoke", scopes: ["revoke:execute"] }, await collectInput(c, { id: c.req.param("id") })));
}
