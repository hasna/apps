import type { Hono } from "hono";
import { collectInput, runRoute } from "./helpers.js";

export function registerIdentityRoutes(app: Hono): void {
  app.get("/v1/identities", async (c) => runRoute(c, { op: "identity.list", scopes: ["access:read"], entityIdFrom: (i) => i.entity_id as string | undefined }, await collectInput(c)));
  app.post("/v1/identities", async (c) => runRoute(c, { op: "identity.create", scopes: ["access:write"], successStatus: 201, entityIdFrom: (i) => i.entity_id as string | undefined }, await collectInput(c)));
  app.get("/v1/identities/:id", async (c) => runRoute(c, { op: "identity.get", scopes: ["access:read"] }, await collectInput(c, { id: c.req.param("id") })));
  app.patch("/v1/identities/:id", async (c) => runRoute(c, { op: "identity.update", scopes: ["access:write"] }, await collectInput(c, { id: c.req.param("id") })));
  app.post("/v1/identities/:id/suspend", async (c) => runRoute(c, { op: "identity.suspend", scopes: ["identity:admin"] }, await collectInput(c, { id: c.req.param("id") })));
  app.post("/v1/identities/:id/retire", async (c) => runRoute(c, { op: "identity.retire", scopes: ["identity:admin"] }, await collectInput(c, { id: c.req.param("id") })));
}
