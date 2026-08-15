/**
 * Real-transport smoke — deliberately NOT a `bun test` file, so the hermetic
 * preload (bunfig.toml `[test].preload`, which forbids sockets/fetch/spawn) does
 * not apply. Run via `bun run test:transport`.
 *
 *  1. HTTP  — boot the Streamable HTTP server on an ephemeral 127.0.0.1 port
 *             (the exact @hasna/mcp-harness/node path the fleet daemon uses) and
 *             drive a real MCP client: initialize (assert serverInfo.version ==
 *             package version) + tools/list == 18.
 *  2. stdio — spawn the BUILT `dist/mcp/index.js --stdio` bin and do the same
 *             over a real stdio subprocess transport.
 *
 * Exits non-zero on any failure.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MCP_VERSION, startSandboxesHttpServer } from "../../src/mcp/index"

const EXPECTED_TOOLS = 18

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE ASSERT FAILED: ${msg}`)
}

async function httpSmoke(home: string): Promise<void> {
  const server = await startSandboxesHttpServer({ port: 0, hostname: "127.0.0.1", deps: { home, env: {} } })
  const client = new Client({ name: "smoke-http", version: "0.0.0" }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`))
  try {
    assert(server.host === "127.0.0.1", `host=${server.host}`)
    assert(server.port > 0, `port=${server.port}`)
    await client.connect(transport as unknown as Transport)
    const info = client.getServerVersion()
    assert(info?.version === MCP_VERSION, `HTTP serverInfo.version=${info?.version} expected ${MCP_VERSION}`)
    const { tools } = await client.listTools()
    assert(tools.length === EXPECTED_TOOLS, `HTTP tools=${tools.length} expected ${EXPECTED_TOOLS}`)
    console.log(`  [http]  OK  serverInfo.version=${info?.version}  tools=${tools.length}  on 127.0.0.1:${server.port}/mcp`)
  } finally {
    await client.close()
    await transport.close()
    await server.close()
  }
}

async function stdioSmoke(home: string): Promise<void> {
  const entry = join(import.meta.dir, "..", "..", "dist", "mcp", "index.js")
  const client = new Client({ name: "smoke-stdio", version: "0.0.0" }, { capabilities: {} })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, "--stdio"],
    env: { PATH: process.env.PATH ?? "", HOME: home },
  })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert(tools.length === EXPECTED_TOOLS, `stdio tools=${tools.length} expected ${EXPECTED_TOOLS}`)
    console.log(`  [stdio] OK  tools=${tools.length}  via built bin --stdio`)
  } finally {
    await client.close()
    await transport.close()
  }
}

const home = mkdtempSync(join(tmpdir(), "sbx-smoke-"))
let ok = true
try {
  console.log("transport-smoke: real HTTP + stdio round trips")
  await httpSmoke(home)
  await stdioSmoke(home)
  console.log("transport-smoke: PASS")
} catch (err) {
  ok = false
  console.error("transport-smoke: FAIL —", err instanceof Error ? err.message : String(err))
} finally {
  rmSync(home, { recursive: true, force: true })
}
process.exit(ok ? 0 : 1)
