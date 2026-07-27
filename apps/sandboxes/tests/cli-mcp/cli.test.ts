import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
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
  test("--version prints the package.json version (single source of truth, no drift)", async () => {
    // Regression: CLI_VERSION used to be a hardcoded "1.0.0" literal that
    // drifted from every release; it must always equal package.json's version.
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }
    const res = await cli(["--version"])
    expect(res.code).toBe(0)
    expect(res.out.trim()).toBe(pkg.version)
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

  test("legacy create flags route directly to the selected provider", async () => {
    const before = Date.now()
    const res = await cli([
      "--json",
      "create",
      "-p",
      "local",
      "-i",
      "codewith-pr-drain",
      "-n",
      "probe",
      "-t",
      "600",
    ])
    expect(res.code).toBe(0)
    const record = JSON.parse(res.out) as {
      provider: string
      template: string
      metadata: Record<string, string>
      expires_at: string
    }
    expect(record.provider).toBe("local")
    expect(record.template).toBe("codewith-pr-drain")
    expect(record.metadata.name).toBe("probe")
    expect(new Date(record.expires_at).getTime()).toBeGreaterThanOrEqual(before + 600_000)
  })

  test("legacy e2b create reports missing direct credentials, not a cloud-route error", async () => {
    const res = await cli(["create", "-p", "e2b", "-i", "codewith-pr-drain", "-n", "probe", "-t", "600"])
    expect(res.code).toBe(1)
    expect(res.err).toContain("E2B_API_KEY")
    expect(res.err).toContain("direct")
    expect(res.err).toContain("does not route this request through Hasna cloud")
    expect(res.err).not.toContain("Hasna cloud request failed")
  })

  test("legacy agents command returns non-cloud v1 migration guidance", async () => {
    const res = await cli(["agents"])
    expect(res.code).toBe(0)
    expect(res.out).toContain("registry was removed in v1")
    expect(res.out).toContain("E2B_API_KEY")
    expect(res.out).toContain("no cloud request was made")
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
