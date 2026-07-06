import type { Hono } from "hono";
import { collectInput, runRoute } from "./helpers.js";

export function registerScopeRoutes(app: Hono): void {
  app.get("/v1/scopes", async (c) => runRoute(c, { op: "scope.list", scopes: ["access:read"], entityIdFrom: (i) => i.entity_id as string | undefined }, await collectInput(c)));
  app.post("/v1/scopes", async (c) => runRoute(c, { op: "scope.grant", scopes: ["scope:grant"], successStatus: 201 }, await collectInput(c)));
  app.get("/v1/scopes/effective", async (c) => runRoute(c, { op: "scope.effective", scopes: ["access:read"] }, await collectInput(c)));
  app.get("/v1/scopes/:id", async (c) => runRoute(c, { op: "scope.get", scopes: ["access:read"] }, await collectInput(c, { id: c.req.param("id") })));
  app.delete("/v1/scopes/:id", async (c) => runRoute(c, { op: "scope.revoke", scopes: ["scope:grant"] }, await collectInput(c, { id: c.req.param("id") })));
}
