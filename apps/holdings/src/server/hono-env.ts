import type { ApiPrincipal } from "./auth.js";

/** Hono environment: the authenticated principal is attached per-request. */
export interface AppEnv {
  Variables: {
    principal: ApiPrincipal;
  };
}
