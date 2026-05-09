#!/usr/bin/env bun
import { startServer } from './serve.js'
import { packageMetadata } from '../lib/package-metadata.js'

function printHelp(): void {
  console.log(`Usage: economy-serve [options]

REST API server for ${packageMetadata.name}

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

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  printHelp()
  process.exit(0)
}

if (args.includes('--version') || args.includes('-V')) {
  console.log(packageMetadata.version)
  process.exit(0)
}

try {
  startServer(resolvePort(args))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
