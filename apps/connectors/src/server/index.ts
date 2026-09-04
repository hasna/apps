#!/usr/bin/env bun
/**
 * Standalone entry point for the connector API + OAuth server.
 * Usage: connectors-serve [--port 9876]
 */

import { startServer } from "./serve.js";
import pkg from "../../package.json" with { type: "json" };

const DEFAULT_PORT = 9876;

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function printHelp(): void {
  console.log(`Usage: connectors-serve [options]

Start the Connectors API + OAuth server

Options:
  --port <port>     Port to bind (default: ${DEFAULT_PORT})
  --port=<port>     Port to bind (default: ${DEFAULT_PORT})
  -V, --version     Output the version number
  -h, --help        Display help for command`);
}

function parsePort(): number {
  const portArg = process.argv.find((a) => a === "--port" || a.startsWith("--port="));
  if (portArg) {
    if (portArg.includes("=")) {
      return parseInt(portArg.split("=")[1], 10) || DEFAULT_PORT;
    }
    const idx = process.argv.indexOf(portArg);
    return parseInt(process.argv[idx + 1], 10) || DEFAULT_PORT;
  }
  return DEFAULT_PORT;
}

if (hasFlag("--help") || hasFlag("-h")) {
  printHelp();
  process.exit(0);
}

if (hasFlag("--version") || hasFlag("-V")) {
  console.log(pkg.version);
  process.exit(0);
}

startServer(parsePort());
