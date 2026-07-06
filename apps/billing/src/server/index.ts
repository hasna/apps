#!/usr/bin/env bun
import { assertServeSafeToStart, buildApp, getBindHost, getPort } from "./app.js";
import { isApiAuthConfigured } from "./auth.js";
import { resolveStorageMode, scrubDatabaseUrl } from "../config.js";
import { getDatabase } from "../db/database.js";

/** Boot the Hono serve tier (BUILD-SPEC §6.1). */
export function startServer(): { port: number; hostname: string } {
  // Fail-closed if bound wide/cloud without credentials (§6.3).
  assertServeSafeToStart();

  // Warm the store so /ready reflects a real connection; scrub the DSN after
  // connect so it is not readable via /proc or child processes (§2.4).
  if (resolveStorageMode() === "local") getDatabase();
  scrubDatabaseUrl();

  const app = buildApp();
  const port = getPort();
  const hostname = getBindHost();
  Bun.serve({ port, hostname, fetch: app.fetch });
  return { port, hostname };
}

if (import.meta.main) {
  const { port, hostname } = startServer();
  console.log(`billing serve on http://${hostname}:${port} (mode=${resolveStorageMode()})`);
  console.log(`API auth ${isApiAuthConfigured() ? "enabled" : "disabled (local loopback dev only)"}`);
}
