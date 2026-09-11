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
import { runCorpusAdmin } from "./corpus-admin.js";
import { CorpusBindingError } from "./corpus-binding.js";
import pkg from "../../package.json";

// Backend-before-help class (todos row 3c0da7fd): --help/--version must
// answer BEFORE any backend resolution. They previously fell through to
// startApiServer() -> buildDeps() -> createServerPoolFromEnv, which throws
// when HASNA_CONVERSATIONS_DATABASE_URL is unset: the bin exited rc=1 with
// a stack trace and empty stdout. Same pattern as the mcp bin below.
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`conversations-serve — HTTP API server for @hasna/conversations v${pkg.version}

Usage:
  conversations-serve              start the HTTP API server (default port 8080)
  conversations-serve --version    print the package version and exit
  conversations-serve corpus inspect    inspect corpus IDs/count/hash using owner DSN
  conversations-serve corpus adopt --corpus-id ID --tenant-id ID --authority-id ID --actor ID --legacy-receipt-count N --legacy-receipt-digest SHA256
                                  explicitly adopt the inspected corpus

Options:
  -h, --help     show this help and exit
  -V, --version  print the package version and exit

Environment:
  HASNA_CONVERSATIONS_DATABASE_URL=<dsn>       PostgreSQL connection (required)
  HASNA_CONVERSATIONS_API_SIGNING_KEY=<hmac>   (or HASNA_API_SIGNING_KEY)
  PORT (default 8080), HOST (default 0.0.0.0)
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(pkg.version);
  process.exit(0);
}

if (args[0] === "corpus") {
  try { await runCorpusAdmin(args.slice(1)); }
  catch (error) { console.error(error instanceof CorpusBindingError ? error.message : "Corpus administration failed; no successful adoption receipt was confirmed."); process.exitCode = 1; }
} else if (args.length) {
  console.error("Unknown server option; use --help."); process.exitCode = 1;
} else {
  startApiServer();
}
