import type { Hono } from "hono";
import { collectInput, runRoute } from "./helpers.js";

export function registerCredentialRoutes(app: Hono): void {
  app.get("/v1/credentials", async (c) => runRoute(c, { op: "credential.list", scopes: ["access:read"], entityIdFrom: (i) => i.entity_id as string | undefined }, await collectInput(c)));
  app.post("/v1/credentials", async (c) => runRoute(c, { op: "credential.register", scopes: ["credential:admin"], successStatus: 201 }, await collectInput(c)));
  app.get("/v1/credentials/:id", async (c) => runRoute(c, { op: "credential.get", scopes: ["access:read"] }, await collectInput(c, { id: c.req.param("id") })));
  app.delete("/v1/credentials/:id", async (c) => runRoute(c, { op: "credential.revoke", scopes: ["credential:admin"] }, await collectInput(c, { id: c.req.param("id") })));
}
