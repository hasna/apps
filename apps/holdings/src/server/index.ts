#!/usr/bin/env bun
import { resolveServerBackend } from "../config.js";
import { openDatabase } from "../db/database.js";
import { APP_VERSION } from "../version.js";
import { authRequiredFor, createApp } from "./app.js";
import { isApiAuthConfigured } from "./auth.js";

export const DEFAULT_SERVE_PORT = 3489;

export function getPort(): number {
  const raw = process.env["HASNA_HOLDINGS_PORT"] ?? process.env["HOLDINGS_PORT"];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SERVE_PORT;
}

export function getBindHost(): string {
  return process.env["HASNA_HOLDINGS_BIND_HOST"] ?? process.env["HOLDINGS_BIND_HOST"] ?? "127.0.0.1";
}

export function startServer(): ReturnType<typeof Bun.serve> {
  const backend = resolveServerBackend();
  const bindHost = getBindHost();
  const port = getPort();

  // Fail-closed (§6.3): a non-loopback bind or the postgresql backend with no credentials
  // configured must NOT serve an open /v1 surface.
  if (authRequiredFor(bindHost, backend) && !isApiAuthConfigured()) {
    throw new Error(
      `Refusing to start: bind ${bindHost} (backend ${backend}) requires API credentials but none are configured. ` +
        "Set HASNA_HOLDINGS_API_CREDENTIALS (or HASNA_HOLDINGS_API_KEY).",
    );
  }

  const db = openDatabase();
  const app = createApp({ db, bindHost, backend });
  const server = Bun.serve({ port, hostname: bindHost, fetch: app.fetch });
  console.error(`holdings-serve v${APP_VERSION} (${backend}) listening on http://${bindHost}:${port}`);
  return server;
}

if (import.meta.main) {
  try {
    startServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
