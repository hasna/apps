import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  createSandboxesMcpServer,
  DEFAULT_MCP_HTTP_PORT,
  isStdioMode,
  MCP_VERSION,
  resolveMcpHttpPort,
  SANDBOX_TOOLS,
  startSandboxesHttpServer,
} from "../../src/mcp/index"

// NOTE: this repo's `bun test` preloads tests/managed-adapters/hermetic-preload.ts
// (see bunfig.toml), which forbids sockets, `fetch`, and child_process. A real
// Streamable-HTTP round trip therefore lives in `bun run test:transport`
// (tests/transport/transport-smoke.ts). Here we cover, hermetically:
//   - transport SELECTION (the load-bearing default-HTTP contract), and
//   - the initialize handshake + tools/list over an in-memory transport,
//     asserting serverInfo.version == package version and the 18-tool set.

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sbx-http-"))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe("sandboxes-mcp transport selection", () => {
  // The fleet systemd unit runs the bin with no args and no MCP_* env, so the
  // default transport MUST be HTTP (matching @hasna/sandboxes@0.2.5). If this
  // flipped to stdio, the swap would leave :8875 dead.
  test("no-arg / no-env invocation defaults to HTTP (not stdio)", () => {
    expect(isStdioMode([], {})).toBe(false)
    expect(isStdioMode(["--stdio"], {})).toBe(true)
    expect(isStdioMode([], { MCP_STDIO: "1" })).toBe(true)
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8875)
  })

  test("resolveMcpHttpPort honors flags/env and defaults to 8875", () => {
    expect(resolveMcpHttpPort([], {})).toBe(8875)
    expect(resolveMcpHttpPort(["--port", "9001"], {})).toBe(9001)
    expect(resolveMcpHttpPort(["--port=9002"], {})).toBe(9002)
    expect(resolveMcpHttpPort([], { MCP_HTTP_PORT: "9003" })).toBe(9003)
    expect(() => resolveMcpHttpPort(["--port", "nope"], {})).toThrow()
  })

  test("startSandboxesHttpServer is exported for the HTTP entrypoint", () => {
    expect(typeof startSandboxesHttpServer).toBe("function")
  })
})

describe("sandboxes-mcp initialize + tools/list", () => {
  test("handshake reports the package version and exactly 18 tools", async () => {
    const server = createSandboxesMcpServer({ home, env: {}, secretsReader: () => undefined })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: "init-test", version: "0.0.0" }, { capabilities: {} })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    // serverInfo.version comes from the initialize handshake — this is exactly
    // what the post-flip curl on :8875 asserts (serverInfo.version == 1.0.x).
    expect(client.getServerVersion()?.version).toBe(MCP_VERSION)

    const { tools } = await client.listTools()
    expect(tools.length).toBe(SANDBOX_TOOLS.length)
    expect(tools.length).toBe(18)
    for (const expected of ["create_sandbox", "exec_command", "read_file", "write_file", "version", "health"]) {
      expect(tools.map((t) => t.name)).toContain(expected)
    }
    await client.close()
  })
})
