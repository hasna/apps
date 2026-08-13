#!/usr/bin/env bun
import { resolveStorageMode } from "../config.js";
import { APP_VERSION } from "../version.js";
import { createApp } from "./app.js";
import { isApiAuthConfigured } from "./auth.js";
import { authApplies, getBindHost, getPort, isLoopbackBind } from "./request-auth.js";

// Boot the Hono serve tier. Fail-closed: a non-loopback bind or cloud mode with
// no credentials configured refuses to start rather than serving open.
function assertAuthSafe(): void {
  const openBind = !isLoopbackBind() || resolveStorageMode() === "cloud";
  if (openBind && !isApiAuthConfigured()) {
    throw new Error(
      "Refusing to start: non-loopback/cloud bind requires API credentials. " +
        "Set HASNA_CONSOLIDATIONS_API_CREDENTIALS (or bind 127.0.0.1 in local mode).",
    );
  }
}

if (import.meta.main) {
  assertAuthSafe();
  const app = createApp();
  const port = getPort();
  const hostname = getBindHost();
  Bun.serve({ port, hostname, fetch: app.fetch });
  console.log(`consolidations-serve v${APP_VERSION} on http://${hostname}:${port} (mode=${resolveStorageMode()})`);
  console.log(`/v1 auth ${authApplies() ? "enabled" : "disabled (loopback + local)"}`);
}

export { createApp };
