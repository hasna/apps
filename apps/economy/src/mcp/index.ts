#!/usr/bin/env bun
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { packageMetadata } from '../lib/package-metadata.js'
import { buildServer } from './server.js'
import { isHttpMode, isStdioMode, resolveHttpPort, startHttpServer } from './http.js'

function printHelp(): void {
  console.log(`Usage: economy-mcp [options]

Runs the ${packageMetadata.name} MCP server (stdio by default).

Options:
      --http         Serve MCP over Streamable HTTP on 127.0.0.1
  -p, --port <port>  HTTP port (default: MCP_HTTP_PORT or 8860)
  -V, --version      output the version number
  -h, --help         display help for command

Environment:
  MCP_HTTP=1         Enable HTTP mode
  MCP_HTTP_PORT      Override default HTTP port (8860)`)
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

async function main(): Promise<void> {
  if (isStdioMode(args) || !isHttpMode(args)) {
    const server = buildServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)
    return
  }

  startHttpServer({ port: resolveHttpPort(args) })
  await new Promise<never>(() => {})
}

main().catch((error) => {
  // The MESSAGE, not the Error object: Bun renders an Error with its code
  // frame first, which buried the fail-closed diagnostic (the Keychain item,
  // the credentials file and HASNA_ECONOMY_API_KEY) under a stack excerpt.
  console.error('MCP server error:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
