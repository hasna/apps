import type { Hono } from "hono";
import type { AppEnv } from "../hono-env.js";
import { OP_REGISTRY } from "../../services/registry.js";
import { mountOps, type RouteDeps } from "./shared.js";

// /v1 routes for the registration resource. Handlers dispatch through the shared
// service layer (invokeOp) — never direct db/crud — preserving interface parity.
export function registerRegistrationsRoutes(app: Hono<AppEnv>, deps: RouteDeps): void {
  mountOps(app, OP_REGISTRY.filter((op) => op.resource === "registration"), deps);
}
