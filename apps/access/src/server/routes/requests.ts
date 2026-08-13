import type { Hono } from "hono";
import { collectInput, runRoute } from "./helpers.js";

export function registerRequestRoutes(app: Hono): void {
  app.get("/v1/requests", async (c) => runRoute(c, { op: "request.list", scopes: ["access:read"], entityIdFrom: (i) => i.entity_id as string | undefined }, await collectInput(c)));
  app.post("/v1/requests", async (c) => runRoute(c, { op: "request.create", scopes: ["access:read"], successStatus: 201 }, await collectInput(c)));
  app.get("/v1/requests/:id", async (c) => runRoute(c, { op: "request.get", scopes: ["access:read"] }, await collectInput(c, { id: c.req.param("id") })));
  app.post("/v1/requests/:id/approve", async (c) => runRoute(c, { op: "request.approve", scopes: ["elevation:approve"] }, await collectInput(c, { id: c.req.param("id") })));
  app.post("/v1/requests/:id/provision", async (c) => runRoute(c, { op: "request.provision", scopes: ["credential:admin"] }, await collectInput(c, { id: c.req.param("id") })));
  app.post("/v1/requests/:id/fail", async (c) => runRoute(c, { op: "request.fail", scopes: ["access:write"] }, await collectInput(c, { id: c.req.param("id") })));
  app.post("/v1/requests/:id/cancel", async (c) => runRoute(c, { op: "request.cancel", scopes: ["access:write"] }, await collectInput(c, { id: c.req.param("id") })));
}
