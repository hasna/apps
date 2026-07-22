import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createSandboxesMcpServer, MCP_VERSION, SANDBOX_TOOLS } from "../../src/mcp/index"

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sbx-mcp-"))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

async function connect(): Promise<Client> {
  const server = createSandboxesMcpServer({ home, env: {}, secretsReader: () => undefined })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function payload(result: unknown): unknown {
  const typed = result as { content?: Array<{ type: string; text?: string }> }
  const text = typed.content?.find((c) => c.type === "text")?.text ?? "{}"
  return JSON.parse(text)
}

describe("sandboxes-mcp server", () => {
  test("advertises the sandbox lifecycle tools with matching names", async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    for (const expected of [
      "create_sandbox",
      "list_sandboxes",
      "get_sandbox",
      "delete_sandbox",
      "stop_sandbox",
      "exec_command",
      "read_file",
      "write_file",
      "list_files",
      "get_logs",
      "expose_port",
      "snapshot_sandbox",
      "upload_dir",
      "run_agent",
      "version",
      "health",
    ]) {
      expect(names).toContain(expected)
    }
    expect(tools.length).toBe(SANDBOX_TOOLS.length)
    await client.close()
  })

  test("full lifecycle via tool calls", async () => {
    const client = await connect()

    const created = payload(await client.callTool({ name: "create_sandbox", arguments: { provider: "local" } })) as { id: string }
    expect(created.id).toMatch(/^sbx_local_/u)

    await client.callTool({ name: "write_file", arguments: { sandbox_id: created.id, path: "a.txt", content: "mcp-data" } })

    const read = payload(await client.callTool({ name: "read_file", arguments: { sandbox_id: created.id, path: "a.txt" } })) as {
      content: string
    }
    expect(read.content).toBe("mcp-data")

    const exec = payload(
      await client.callTool({ name: "exec_command", arguments: { sandbox_id: created.id, command: ["cat", "a.txt"] } }),
    ) as { exit_code: number; stdout: string }
    expect(exec.exit_code).toBe(0)
    expect(exec.stdout).toBe("mcp-data")

    const execStr = payload(
      await client.callTool({ name: "exec_command", arguments: { sandbox_id: created.id, command: "echo shell-form" } }),
    ) as { stdout: string }
    expect(execStr.stdout).toBe("shell-form\n")

    const listed = payload(await client.callTool({ name: "list_sandboxes", arguments: { provider: "local" } })) as Array<{ id: string }>
    expect(listed.map((r) => r.id)).toContain(created.id)

    const port = payload(await client.callTool({ name: "expose_port", arguments: { sandbox_id: created.id, port: 3000 } })) as {
      port: number
    }
    expect(port.port).toBe(3000)

    const del = payload(await client.callTool({ name: "delete_sandbox", arguments: { sandbox_id: created.id } })) as {
      deleted: boolean
    }
    expect(del.deleted).toBe(true)

    await client.close()
  })

  test("upload_dir uploads a local directory into the sandbox", async () => {
    const client = await connect()
    const created = payload(await client.callTool({ name: "create_sandbox", arguments: {} })) as { id: string }

    const src = mkdtempSync(join(tmpdir(), "sbx-upload-"))
    await Bun.write(join(src, "one.txt"), "1")
    await Bun.write(join(src, "nested/two.txt"), "2")
    const up = payload(
      await client.callTool({ name: "upload_dir", arguments: { sandbox_id: created.id, local_dir: src, dest: "/workspace/app" } }),
    ) as { uploaded: number }
    expect(up.uploaded).toBe(2)

    const read = payload(
      await client.callTool({ name: "read_file", arguments: { sandbox_id: created.id, path: "/workspace/app/nested/two.txt" } }),
    ) as { content: string }
    expect(read.content).toBe("2")
    rmSync(src, { recursive: true, force: true })
    await client.close()
  })

  test("version and health tools", async () => {
    const client = await connect()
    const version = payload(await client.callTool({ name: "version", arguments: {} })) as { version: string; providers: string[] }
    expect(version.version).toBe(MCP_VERSION)
    // MCP and CLI must both report package.json's version — one source of truth.
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
    expect(version.version).toBe(pkg.version)
    expect(version.providers).toContain("local")
    const health = payload(await client.callTool({ name: "health", arguments: {} })) as { status: string }
    expect(health.status).toBe("ok")
    await client.close()
  })

  test("errors are returned as tool errors, not thrown", async () => {
    const client = await connect()
    const result = (await client.callTool({ name: "get_sandbox", arguments: { sandbox_id: "missing" } })) as {
      isError?: boolean
    }
    expect(result.isError).toBe(true)
    const body = payload(result as never) as { error: string }
    expect(body.error).toContain("missing")

    const e2b = (await client.callTool({ name: "create_sandbox", arguments: { provider: "e2b" } })) as { isError?: boolean }
    expect(e2b.isError).toBe(true)
    expect((payload(e2b as never) as { error: string }).error).toContain("E2B_API_KEY")
    await client.close()
  })
})
