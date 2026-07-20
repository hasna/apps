import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli, type CliDeps } from "../../src/cli/index"

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sbx-cli-"))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

interface Captured {
  code: number
  out: string
  err: string
}

async function cli(args: string[], extra: Partial<CliDeps> = {}): Promise<Captured> {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, {
    home,
    env: {},
    secretsReader: () => undefined,
    stdout: (chunk) => out.push(chunk),
    stderr: (chunk) => err.push(chunk),
    ...extra,
  })
  return { code, out: out.join(""), err: err.join("") }
}

async function createSandbox(): Promise<string> {
  const res = await cli(["--json", "--provider", "local", "create"])
  expect(res.code).toBe(0)
  return (JSON.parse(res.out) as { id: string }).id
}

describe("sandboxes CLI", () => {
  test("--version prints version", async () => {
    const res = await cli(["--version"])
    expect(res.code).toBe(0)
    expect(res.out).toContain("1.0.0")
  })

  test("create + get + list + destroy", async () => {
    const id = await createSandbox()

    const get = await cli(["--json", "--provider", "local", "get", id])
    expect(get.code).toBe(0)
    expect((JSON.parse(get.out) as { id: string }).id).toBe(id)

    const list = await cli(["--json", "--provider", "local", "list"])
    expect((JSON.parse(list.out) as Array<{ id: string }>).map((r) => r.id)).toContain(id)

    const destroy = await cli(["--provider", "local", "destroy", id])
    expect(destroy.code).toBe(0)
    expect(destroy.out).toContain("destroyed")
  })

  test("write-file / read-file / exec / list-files", async () => {
    const id = await createSandbox()

    const write = await cli(["--provider", "local", "write-file", id, "src/x.txt", "--content", "payload-42"])
    expect(write.code).toBe(0)
    expect(write.out).toContain("wrote 10 bytes")

    const read = await cli(["--provider", "local", "read-file", id, "src/x.txt"])
    expect(read.code).toBe(0)
    expect(read.out).toBe("payload-42")

    const exec = await cli(["--provider", "local", "exec", id, "cat", "src/x.txt"])
    expect(exec.code).toBe(0)
    expect(exec.out).toBe("payload-42")

    const listFiles = await cli(["--json", "--provider", "local", "list-files", id, "/workspace/src"])
    expect((JSON.parse(listFiles.out) as Array<{ path: string }>).some((e) => e.path === "/workspace/src/x.txt")).toBe(true)
  })

  test("exec propagates non-zero exit codes", async () => {
    const id = await createSandbox()
    const res = await cli(["--provider", "local", "exec", id, "false"])
    expect(res.code).toBe(1)
  })

  test("expose-port and snapshot", async () => {
    const id = await createSandbox()
    const port = await cli(["--json", "--provider", "local", "expose-port", id, "5173"])
    expect((JSON.parse(port.out) as { port: number }).port).toBe(5173)

    const snap = await cli(["--json", "--provider", "local", "snapshot", id])
    expect((JSON.parse(snap.out) as { sandbox_id: string }).sandbox_id).toBe(id)
  })

  test("missing sandbox is a clean error, not a crash", async () => {
    const res = await cli(["--provider", "local", "get", "does-not-exist"])
    expect(res.code).toBe(1)
    expect(res.err).toContain("error:")
  })

  test("e2b provider without credentials fails with a clear message (no network)", async () => {
    const res = await cli(["--provider", "e2b", "create"])
    expect(res.code).toBe(1)
    expect(res.err).toContain("E2B_API_KEY")
  })

  test("unknown provider is rejected", async () => {
    const res = await cli(["--provider", "banana", "list"])
    expect(res.code).toBe(1)
    expect(res.err.toLowerCase()).toContain("unknown provider")
  })

  test("invalid numeric options fail cleanly, not with a crash", async () => {
    const id = await createSandbox()
    const bad = await cli(["--provider", "local", "keep-alive", id, "--timeout", "soon"])
    expect(bad.code).toBe(1)
    expect(bad.err).toContain("--timeout")
    const badPort = await cli(["--provider", "local", "expose-port", id, "abc"])
    expect(badPort.code).toBe(1)
    expect(badPort.err.toLowerCase()).toContain("port")
  })
})
