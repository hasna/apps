#!/usr/bin/env bun
import { startServer } from './serve.js'
import { packageMetadata } from '../lib/package-metadata.js'

function printHelp(): void {
  console.log(`Usage: economy-serve [command] [options]

REST API server for ${packageMetadata.name}
Foundation probes: GET /health, /ready, /version -> { status, version, mode }
Versioned API: /v1/* (API-key auth via @hasna/contracts in cloud mode)

Commands:
  (default)          start the HTTP server
  migrate            apply the cloud Postgres schema + api_keys, then exit
  version            print { status, version, mode }

Options:
  -p, --port <port>  Port to bind (default: ECONOMY_PORT or 3456)
  -V, --version      output the version number
  -h, --help         display help for command`)
}

function resolvePort(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' || arg === '-p') {
      const raw = argv[i + 1]
      if (!raw) throw new Error(`Invalid port: ${raw ?? ''}`)
      return parsePort(raw, 'port')
    }
  }

  return parsePort(process.env['ECONOMY_PORT'] ?? '3456', 'ECONOMY_PORT')
}

function parsePort(raw: string, label: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid ${label}: ${raw}`)
  }
  return value
}

/**
 * Apply the cloud (RDS) Postgres schema + the api_keys table, then exit.
 * This is the one-shot ECS migration task command:
 *   bun dist/server/index.js migrate
 */
async function runMigrate(): Promise<void> {
  const { getCloudDatabaseUrl, createCloudPool, authClientFromPool, cloudMigrations } = await import('../db/cloud.js')
  const { applyPgMigrations } = await import('../db/pg-migrate.js')
  const { ApiKeyStore } = await import('@hasna/contracts/auth')
  const dsn = getCloudDatabaseUrl()
  if (!dsn) throw new Error('migrate requires a Postgres DSN: set HASNA_ECONOMY_DATABASE_URL (or ECONOMY_DATABASE_URL / DATABASE_URL)')
  const result = await applyPgMigrations(dsn, cloudMigrations(), 'economy')
  const pool = createCloudPool(dsn)
  try {
    await new ApiKeyStore(authClientFromPool(pool)).ensureSchema()
  } finally {
    await pool.end().catch(() => {})
  }
  console.log(JSON.stringify({ evt: 'migrate', service: result.service, applied: result.applied, alreadyApplied: result.alreadyApplied, errors: result.errors, api_keys: 'ensured' }))
  if (result.errors.length) process.exit(1)
}

const args = process.argv.slice(2)
const sub = args[0]

if (sub === 'version') {
  console.log(JSON.stringify({ status: 'ok', version: packageMetadata.version, mode: process.env['HASNA_ECONOMY_STORAGE_MODE'] === 'cloud' ? 'self_hosted' : 'local' }))
  process.exit(0)
}

if (sub === 'migrate') {
  runMigrate().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
} else if (args.includes('--help') || args.includes('-h')) {
  printHelp()
  process.exit(0)
} else if (args.includes('--version') || args.includes('-V')) {
  console.log(packageMetadata.version)
  process.exit(0)
} else {
  try {
    startServer(resolvePort(args))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
