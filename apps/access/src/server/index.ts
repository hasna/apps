#!/usr/bin/env bun
import { buildApp } from "./app.js";
import { isApiAuthConfigured } from "./auth.js";
import { resolveStorageMode } from "../config.js";
import { APP_VERSION } from "../version.js";

export const DEFAULT_SERVE_PORT = 3483;

export function getPort(): number {
  const raw = process.env["HASNA_ACCESS_PORT"] || process.env["ACCESS_PORT"];
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SERVE_PORT;
}

export function getBindHost(): string {
  return process.env["HASNA_ACCESS_BIND_HOST"] || process.env["ACCESS_BIND_HOST"] || "127.0.0.1";
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Fail-closed startup guard (§6.3): auth is decoupled from storage mode. Serving
 * /v1 unauthenticated is permitted ONLY when bound strictly to loopback AND mode
 * is local. A cloud-mode or non-loopback bind with no credentials configured is
 * a hard startup error.
 */
export function assertAuthPosture(host: string, mode: "local" | "cloud"): void {
  const open = !isApiAuthConfigured();
  if (open && (!isLoopback(host) || mode === "cloud")) {
    throw new Error(
      "Refusing to start: /v1 would be served without credentials on a non-loopback bind or cloud mode. " +
        "Configure HASNA_ACCESS_API_CREDENTIALS (or bind to 127.0.0.1 in local mode).",
    );
  }
}

export function startServer(): ReturnType<typeof Bun.serve> {
  const port = getPort();
  const host = getBindHost();
  const mode = resolveStorageMode();
  assertAuthPosture(host, mode);
  const app = buildApp();
  const server = Bun.serve({ port, hostname: host, fetch: app.fetch });
  console.error(`access-serve v${APP_VERSION} listening on http://${host}:${port} (mode=${mode})`);
  return server;
}

if (import.meta.main) {
  startServer();
}
