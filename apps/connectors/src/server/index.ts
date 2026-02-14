#!/usr/bin/env bun
/**
 * Standalone entry point for the connector auth dashboard server.
 * Usage: connectors-serve [--port 19426]
 */

import { startServer } from "./serve.js";

const DEFAULT_PORT = 19426;

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

startServer(parsePort());
