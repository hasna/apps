#!/usr/bin/env bun
import { serverBackend } from "../config.js";
import { APP_VERSION } from "../version.js";
import { createApp } from "./app.js";
import { isApiAuthConfigured } from "./auth.js";
import { assertServeSafe, authRequired, getBindHost, getPort } from "./runtime.js";

export { createApp } from "./app.js";

function main(): void {
  // Binds-before-version class (todos row 7e5f8f3d): --version/--help must
  // answer BEFORE assertServeSafe()/Bun.serve. They previously fell through
  // and bound :3482 with no output.
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(APP_VERSION);
    process.exit(0);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Usage: controls-serve [options]

Runs the @hasna/controls HTTP API.

Options:
  -V, --version  output the version number
  -h, --help     display help for command

Environment:
  CONTROLS_PORT          Listen port (default: 3482)
  CONTROLS_BIND_HOST     Bind address (default: 127.0.0.1)`);
    process.exit(0);
  }
  // Fail-closed: refuse to serve open on a non-loopback / PostgreSQL bind.
  assertServeSafe(isApiAuthConfigured());

  const app = createApp();
  const port = getPort();
  const hostname = getBindHost();

  Bun.serve({ port, hostname, fetch: app.fetch });

  console.log(`@hasna/controls serve listening on http://${hostname}:${port} (backend=${serverBackend()})`);
  console.log(`API auth ${authRequired() ? "REQUIRED" : isApiAuthConfigured() ? "enabled" : "open (loopback + SQLite backend only)"}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
