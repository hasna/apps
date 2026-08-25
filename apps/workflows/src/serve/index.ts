#!/usr/bin/env bun
/**
 * workflows-serve — the HTTP server surface of @hasna/workflows.
 *
 * Answers --version/--help before binding. Serves /health, /ready,
 * /version and /openapi.json via the shared request handler.
 */
import { createWorkflowsService, packageVersion } from "../service.js";
import { createWorkflowsServer } from "./server.js";

const HELP_TEXT = `workflows-serve — HTTP server for @hasna/workflows

Usage:
  workflows-serve [--version] [--help]

Endpoints:
  /health         service health
  /ready          service readiness
  /version        service version
  /trigger        authenticated run trigger (POST, Bearer token)
  /openapi.json   API document

Configuration (env):
  HASNA_WORKFLOWS_PORT  port (default 8790)
  HASNA_WORKFLOWS_HOST  bind host (default 127.0.0.1)
  WORKFLOWS_API_KEY     token required by the authenticated /trigger`;

const argv = process.argv.slice(2);
if (argv.includes("--version") || argv.includes("-v")) {
  console.log(packageVersion());
  process.exit(0);
}
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const service = createWorkflowsService();
const server = createWorkflowsServer(service);
console.log(`workflows-serve listening on http://${service.config.host}:${server.port}`);
