import type { Hono } from "hono";
import { collectInput, runRoute } from "./helpers.js";

export function registerElevationRoutes(app: Hono): void {
  app.get("/v1/elevations", async (c) => runRoute(c, { op: "elevation.list", scopes: ["access:read"], entityIdFrom: (i) => i.entity_id as string | undefined }, await collectInput(c)));
  app.post("/v1/elevations", async (c) => runRoute(c, { op: "elevation.request", scopes: ["access:write"], successStatus: 201 }, await collectInput(c)));
  app.post("/v1/elevations/expire", async (c) => runRoute(c, { op: "elevation.expire", scopes: ["access:write"] }, await collectInput(c)));
  app.get("/v1/elevations/:id", async (c) => runRoute(c, { op: "elevation.get", scopes: ["access:read"] }, await collectInput(c, { id: c.req.param("id") })));
  app.post("/v1/elevations/:id/approve", async (c) => runRoute(c, { op: "elevation.approve", scopes: ["elevation:approve"] }, await collectInput(c, { id: c.req.param("id") })));
  app.delete("/v1/elevations/:id", async (c) => runRoute(c, { op: "elevation.revoke", scopes: ["revoke:execute"] }, await collectInput(c, { id: c.req.param("id") })));
}
