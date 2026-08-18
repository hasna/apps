#!/usr/bin/env bun
import { createApp, getBindHost, isLoopback } from "./app.js";
import { isApiAuthConfigured } from "./auth.js";
import { resolveServerBackend } from "../config.js";
import { APP_VERSION } from "../version.js";

export function getPort(): number {
  return Number.parseInt(process.env["HASNA_TREASURY_PORT"] || process.env["TREASURY_PORT"] || "3486", 10);
}

/**
 * Fail-closed startup guard (BUILD-SPEC §6.3): auth is decoupled from the
 * storage backend. Unauthenticated /v1 is permitted ONLY on a loopback bind.
 * A non-loopback bind with no credentials configured is a hard startup error —
 * never silently serve open.
 */
export function assertServeSafety(): void {
  const host = getBindHost();
  const openOk = isLoopback(host);
  if (!openOk && !isApiAuthConfigured()) {
    throw new Error(
      `Refusing to start: bind=${host} requires API credentials. ` +
        `Set HASNA_TREASURY_API_CREDENTIALS (or HASNA_TREASURY_API_KEY). ` +
        `Unauthenticated /v1 is only allowed on 127.0.0.1.`,
    );
  }
}

export function startServer(): ReturnType<typeof Bun.serve> {
  assertServeSafety();
  const app = createApp();
  const port = getPort();
  const hostname = getBindHost();
  const server = Bun.serve({ port, hostname, fetch: app.fetch });
  console.log(`treasury-serve v${APP_VERSION} on http://${hostname}:${port} (backend=${resolveServerBackend()})`);
  console.log(`API auth ${isApiAuthConfigured() ? "enabled" : "disabled (loopback dev only)"}`);
  return server;
}

if (import.meta.main) {
  startServer();
}
