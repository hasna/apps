#!/usr/bin/env bun
/**
 * Usage: files-serve [--port 19432]
 * Default port: 19432. Auto-finds next free port if taken.
 *
 * `--version` and `--help` are answered from argv alone and exit BEFORE any
 * port is probed or bound: the published 0.4.0 bound 127.0.0.1:19432 on
 * `files-serve --version` (hasna/apps#1720, station03 release verification).
 */
import { createRequire } from "module";
import { startServer } from "./serve.js";
import { getCurrentMachine } from "../db/machines.js";
import { listSources } from "../db/sources.js";
import { indexLocalSource } from "../lib/indexer.js";
import { getAutosyncPeers, markPeerSynced } from "../db/peers.js";
import { syncWithPeer } from "../lib/sync.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const DEFAULT_PORT = 19432;

function printHelp(): void {
  console.log(`Usage: files-serve [options]

Serve the open-files HTTP API.

Options:
  --port <number>   Port to bind (default: ${DEFAULT_PORT})
  -V, --version     Print the package version
  -h, --help        Show this help text`);
}

function shouldShowVersion(): boolean {
  return process.argv.includes("-V") || process.argv.includes("--version");
}

function shouldShowHelp(): boolean {
  return process.argv.includes("-h") || process.argv.includes("--help");
}

function getRequestedPort(): number {
  const portArg = process.argv.find((a) => a === "--port" || a.startsWith("--port="));
  if (portArg) {
    if (portArg.includes("=")) return parseInt(portArg.split("=")[1]!, 10) || DEFAULT_PORT;
    const idx = process.argv.indexOf(portArg);
    return parseInt(process.argv[idx + 1]!, 10) || DEFAULT_PORT;
  }
  return DEFAULT_PORT;
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    try {
      const server = Bun.serve({ port, fetch: () => new Response("") });
      server.stop();
      return port;
    } catch {
      continue;
    }
  }
  return start;
}

if (shouldShowVersion()) {
  console.log(pkg.version);
  process.exit(0);
}

if (shouldShowHelp()) {
  printHelp();
  process.exit(0);
}

const requestedPort = getRequestedPort();
const port = await findFreePort(requestedPort);
if (port !== requestedPort) console.log(`Port ${requestedPort} in use, using ${port}`);
startServer(port);

// When the service runs on Postgres (HASNA_FILES_DATABASE_URL set) it talks to
// the database directly and does NOT index local folders or sync peers (that
// path lives in the CLIENT, not the service).
const postgresBackend = Boolean(
  process.env.HASNA_FILES_DATABASE_URL ?? process.env.FILES_DATABASE_URL,
);

if (!postgresBackend) {
  // Auto-index all enabled local sources on startup (non-blocking)
  const machine = getCurrentMachine();
  for (const source of listSources(machine.id).filter((s) => s.enabled && s.type === "local")) {
    indexLocalSource(source, machine.id).catch(() => {});
  }

  // Auto-sync peers on their configured intervals
  const peers = getAutosyncPeers();
  for (const peer of peers) {
    const intervalMs = peer.sync_interval_minutes * 60 * 1000;
    setInterval(async () => {
      try {
        await syncWithPeer(peer.url);
        markPeerSynced(peer.id);
      } catch { /* ignore */ }
    }, intervalMs);
  }
}
