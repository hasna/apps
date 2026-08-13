#!/usr/bin/env bun
import { assertServeSafeToStart, buildApp, getBindHost, getPort } from "./app.js";
import { isApiAuthConfigured } from "./auth.js";
import { resolveStorageBackend } from "../config.js";
import { getDatabase } from "../db/database.js";

/** Boot the Hono serve tier (BUILD-SPEC §6.1). */
export function startServer(): { port: number; hostname: string } {
  // Fail closed if bound wide or using PostgreSQL without credentials.
  assertServeSafeToStart();

  // Warm SQLite so /ready reflects a real connection. PostgreSQL remains
  // selected by DATABASE_URL for the process lifetime and fails closed in
  // domain handlers until their PostgreSQL query path is implemented.
  if (resolveStorageBackend() === "sqlite") getDatabase();

  const app = buildApp();
  const port = getPort();
  const hostname = getBindHost();
  Bun.serve({ port, hostname, fetch: app.fetch });
  return { port, hostname };
}

if (import.meta.main) {
  const { port, hostname } = startServer();
  console.log(`billing serve on http://${hostname}:${port} (backend=${resolveStorageBackend()})`);
  console.log(`API auth ${isApiAuthConfigured() ? "enabled" : "disabled (SQLite loopback dev only)"}`);
}
