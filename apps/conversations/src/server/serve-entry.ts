#!/usr/bin/env bun
/**
 * conversations-serve bin entrypoint.
 *
 * Starts the HTTP API server against PostgreSQL. Requires:
 *   HASNA_CONVERSATIONS_DATABASE_URL=<dsn>      (app role)
 *   HASNA_CONVERSATIONS_API_SIGNING_KEY=<hmac>  (or HASNA_API_SIGNING_KEY)
 *   PORT (default 8080), HOST (default 0.0.0.0)
 */

import { startApiServer } from "./api.js";

startApiServer();
