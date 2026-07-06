import type { Hono } from "hono";
import { collectInput, runRoute } from "./helpers.js";

export function registerReviewRoutes(app: Hono): void {
  app.get("/v1/reviews", async (c) => runRoute(c, { op: "review.list", scopes: ["access:read"], entityIdFrom: (i) => i.entity_id as string | undefined }, await collectInput(c)));
  app.post("/v1/reviews", async (c) => runRoute(c, { op: "review.schedule", scopes: ["review:manage"], successStatus: 201 }, await collectInput(c)));
  app.get("/v1/reviews/:id", async (c) => runRoute(c, { op: "review.get", scopes: ["access:read"] }, await collectInput(c, { id: c.req.param("id") })));
  app.post("/v1/reviews/:id/start", async (c) => runRoute(c, { op: "review.start", scopes: ["review:manage"] }, await collectInput(c, { id: c.req.param("id") })));
  app.post("/v1/reviews/:id/complete", async (c) => runRoute(c, { op: "review.complete", scopes: ["review:manage"] }, await collectInput(c, { id: c.req.param("id") })));
  app.post("/v1/reviews/:id/cancel", async (c) => runRoute(c, { op: "review.cancel", scopes: ["review:manage"] }, await collectInput(c, { id: c.req.param("id") })));
}
