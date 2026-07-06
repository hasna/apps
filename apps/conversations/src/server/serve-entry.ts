#!/usr/bin/env bun
/**
 * conversations-serve bin entrypoint.
 *
 * Starts the pure-remote (Amendment A1) HTTP API against the app's cloud
 * Postgres. Requires:
 *   HASNA_CONVERSATIONS_STORAGE_MODE=cloud
 *   HASNA_CONVERSATIONS_DATABASE_URL=<dsn>      (app role)
 *   HASNA_CONVERSATIONS_API_SIGNING_KEY=<hmac>  (or HASNA_API_SIGNING_KEY)
 *   PORT (default 8080), HOST (default 0.0.0.0)
 */

import { startApiServer } from "./api.js";

startApiServer();
