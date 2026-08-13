import type { Hono } from "hono";
import { collectInput, runRoute } from "./helpers.js";

export function registerRevocationRoutes(app: Hono): void {
  app.get("/v1/revocations", async (c) => runRoute(c, { op: "revocation.list", scopes: ["access:read"], entityIdFrom: (i) => i.entity_id as string | undefined }, await collectInput(c)));
  app.post("/v1/revocations", async (c) => runRoute(c, { op: "revocation.execute", scopes: ["revoke:execute"], successStatus: 201 }, await collectInput(c)));
}
