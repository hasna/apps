#!/usr/bin/env bun
import { startServer } from "./serve.js";

const pkg = require("../../package.json") as { version: string };

function handleCliFlags(argv: string[]): boolean {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: search-serve [options]");
    console.log("");
    console.log("REST API and dashboard server for @hasna/search");
    console.log("");
    console.log("Options:");
    console.log("  --port <n>     HTTP port (default 19800, or SEARCH_PORT/PORT env)");
    console.log("  --host <host>  HTTP host (default 127.0.0.1, or SEARCH_HOST env)");
    console.log("  -h, --help     display help");
    console.log("  -V, --version  display version");
    return true;
  }

  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(pkg.version);
    return true;
  }

  return false;
}

function resolvePort(argv: string[]): number {
  const portIndex = argv.indexOf("--port");
  if (portIndex >= 0 && argv[portIndex + 1]) {
    return parseInt(argv[portIndex + 1]!, 10);
  }
  return parseInt(Bun.env.SEARCH_PORT ?? Bun.env.PORT ?? "19800");
}

function resolveHost(argv: string[]): string {
  const hostIndex = argv.indexOf("--host");
  if (hostIndex >= 0 && argv[hostIndex + 1]) {
    return argv[hostIndex + 1]!;
  }
  return Bun.env.SEARCH_HOST ?? "127.0.0.1";
}

const argv = process.argv.slice(2);
if (handleCliFlags(argv)) {
  process.exit(0);
}

const port = resolvePort(argv);
const hostname = resolveHost(argv);

startServer(port, { hostname });
