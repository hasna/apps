#!/usr/bin/env bun
import { openDatabase } from '../db/database.js'
import { ingestOtelRows, parseOtlpMetrics, parseSimpleIngest } from '../ingest/otel.js'
import { maybePushAfterIngest } from '../lib/native-storage.js'
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
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: economy-otel [--port 4318]

OTLP/HTTP metrics sidecar — ingests *.cost.* / *.token.* metrics into economy.db

Endpoints:
  POST /v1/metrics     OTLP JSON metrics
  POST /ingest         Simplified single-event JSON
  GET  /health         Health check`)
  process.exit(0)
}

const port = resolvePort(args)
const db = openDatabase()

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

    const result = await ingestOtelRows(db, rows)
    await maybePushAfterIngest()
    return Response.json({ ingested: result.requests, sessions: result.sessions })
  },
})

console.log(`economy-otel listening on http://127.0.0.1:${server.port}`)
