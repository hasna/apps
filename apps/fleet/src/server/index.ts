#!/usr/bin/env bun
import { buildApp } from "./app.js";
import { APP_VERSION } from "../version.js";

export { buildApp } from "./app.js";

const DEFAULT_PORT = 3485;

export function getPort(): number {
  const raw = process.env["HASNA_FLEET_PORT"] || process.env["FLEET_PORT"];
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

export function getBindHost(): string {
  return process.env["HASNA_FLEET_BIND_HOST"] || process.env["FLEET_BIND_HOST"] || "127.0.0.1";
}

if (import.meta.main) {
  const port = getPort();
  const hostname = getBindHost();
  const app = buildApp({ bindHost: hostname });
  Bun.serve({ port, hostname, fetch: app.fetch });
  console.error(`fleet-serve v${APP_VERSION} listening on http://${hostname}:${port} (/health /ready /version /v1)`);
}
