#!/usr/bin/env bun
import { openDatabase } from '../db/database.js'
import { ingestOtelRows, parseOtlpMetrics, parseSimpleIngest } from '../ingest/otel.js'
import type { OtelIngestRow } from '../ingest/otel.js'
import { pushIngestRows } from '../lib/cloud-ingest.js'
import { economyCloudStorage } from '../lib/cloud-storage.js'
import type { ActiveEconomyCloudStorage, EconomyCloudStorage } from '../lib/cloud-storage.js'
import { packageMetadata } from '../lib/package-metadata.js'

function resolvePort(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') {
      return Number(argv[i + 1] ?? 4318)
    }
  }
  return Number(process.env['ECONOMY_OTEL_PORT'] ?? 4318)
}

const args = process.argv.slice(2)
// Binds-before-version class (todos row 7e5f8f3d): --version must answer
// BEFORE resolvePort()/Bun.serve. It previously fell through and bound the
// OTLP listener (:4318) with no output.
if (args.includes('--version') || args.includes('-V')) {
  console.log(packageMetadata.version)
  process.exit(0)
}
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: economy-otel [options]

OTLP/HTTP metrics sidecar — ingests *.cost.* / *.token.* metrics into Economy

Options:
  -p, --port <port>  Port to bind (default: ECONOMY_OTEL_PORT or 4318)
  -V, --version      output the version number
  -h, --help         display help for command

Environment:
  ECONOMY_OTEL_PORT  Override the default port (4318)
  ECONOMY_OTEL_BIND  Bind address (default: 127.0.0.1)

Storage (decided at startup, before the listener binds):
  A credential resolved by @hasna/contracts (Keychain item
  hasna.credentials.economy.api-key, ~/.hasna/economy/config/credentials,
  HASNA_ECONOMY_API_KEY) forwards every accepted payload to the hosted
  API's /v1/ingest. HASNA_ECONOMY_LOCAL=1 writes the on-box SQLite store
  instead. With neither the sidecar fails closed (exit 1, no listener).

Endpoints:
  POST /v1/metrics     OTLP JSON metrics
  POST /ingest         Simplified single-event JSON
  GET  /health         Health check`)
  process.exit(0)
}

const port = resolvePort(args)

/**
 * The sidecar follows the ONE storage seam the CLI and the MCP server use,
 * decided here — before the listener binds — and never a silent local store:
 *
 *   - a credential from the @hasna/contracts chain makes it a HOSTED
 *     forwarder: every accepted payload is pushed to the shared API's
 *     /v1/ingest, and nothing is written under the app home;
 *   - the explicit HASNA_ECONOMY_LOCAL=1 opt-in writes the on-box SQLite
 *     store (the seam announces local mode on stderr, once);
 *   - nothing configured FAILS CLOSED: exit 1 with the resolver's diagnostic,
 *     no listener, no SQLite file (hasna/apps#1720).
 */
function resolveStorage(): EconomyCloudStorage {
  try {
    return economyCloudStorage()
  } catch (error) {
    console.error(`economy-otel: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

const storage = resolveStorage()
const localDb = storage.active ? null : openDatabase()

/**
 * Hosted lane: run the SAME ingest against a scratch in-memory store, then
 * push the produced request/session rows to the shared API (idempotent
 * upserts by primary key). `cost_centers` is not part of /v1/ingest, so the
 * pushed rows carry their cost_center_id but the server's cost-center
 * registry is not updated by the sidecar.
 */
async function forwardRows(
  cloud: ActiveEconomyCloudStorage,
  rows: OtelIngestRow[],
): Promise<{ requests: number; sessions: number; forwarded: number }> {
  const scratch = openDatabase(':memory:', true)
  try {
    const result = await ingestOtelRows(scratch, rows)
    const pushed = await pushIngestRows(cloud, scratch)
    return { ...result, forwarded: pushed.total }
  } finally {
    try { scratch.close() } catch { /* best effort */ }
  }
}

const server = Bun.serve({
  port,
  hostname: process.env['ECONOMY_OTEL_BIND'] ?? '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'economy-otel', version: packageMetadata.version })
    }

    if (req.method !== 'POST') {
      return Response.json({ error: 'method not allowed' }, { status: 405 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ error: 'invalid JSON' }, { status: 400 })
    }

    let rows = url.pathname === '/ingest'
      ? (() => { const one = parseSimpleIngest(body); return one ? [one] : [] })()
      : parseOtlpMetrics(body)

    if (rows.length === 0) {
      return Response.json({ ingested: 0, message: 'no matching metrics' })
    }

    if (storage.active) {
      try {
        const result = await forwardRows(storage, rows)
        return Response.json({ ingested: result.requests, sessions: result.sessions, forwarded: result.forwarded })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return Response.json({ error: `forward to the economy API failed: ${reason}` }, { status: 502 })
      }
    }

    const result = await ingestOtelRows(localDb!, rows)
    return Response.json({ ingested: result.requests, sessions: result.sessions })
  },
})

console.log(`economy-otel listening on http://127.0.0.1:${server.port}`)
