#!/usr/bin/env bun
/**
 * telephony-serve entrypoint — the HTTP API a user runs on their own server.
 *
 * Starts the serve, which reads/writes its PostgreSQL backend directly and
 * authenticates requests with @hasna/contracts API-key middleware. Requires
 * HASNA_TELEPHONY_DATABASE_URL (which selects the `postgresql` backend on its
 * own) and a signing secret (HASNA_TELEPHONY_API_SIGNING_KEY).
 */
import { startTelephonyServe } from "./cloud-serve.js";

startTelephonyServe().catch((error) => {
  console.error("[telephony-serve] failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
