import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalSandboxBackend } from "../../src/runtime/local-backend"
import { SandboxNotFoundError } from "../../src/runtime/types"

let home: string
let backend: LocalSandboxBackend

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sbx-local-"))
  backend = new LocalSandboxBackend(home)
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe("LocalSandboxBackend lifecycle", () => {
  test("create -> get -> list -> destroy", async () => {
    const created = await backend.create({ metadata: { role: "test" } })
    expect(created.id).toMatch(/^sbx_local_/u)
    expect(created.provider).toBe("local")
    expect(created.status).toBe("running")

    const got = await backend.get(created.id)
    expect(got.id).toBe(created.id)
    expect(got.metadata.role).toBe("test")

    const list = await backend.list()
    expect(list.map((r) => r.id)).toContain(created.id)

    await backend.destroy(created.id)
    await expect(backend.get(created.id)).rejects.toBeInstanceOf(SandboxNotFoundError)
  })

  test("persists across backend instances (separate CLI invocations)", async () => {
    const created = await backend.create({})
    const reopened = new LocalSandboxBackend(home)
    const got = await reopened.get(created.id)
    expect(got.id).toBe(created.id)
  })

  test("write/read/list files round-trips through guest-broker framing", async () => {
    const sb = await backend.create({})
    const receipt = await backend.writeFile(sb.id, "src/app.ts", new TextEncoder().encode("export const x = 1\n"))
    expect(receipt.path).toBe("/workspace/src/app.ts")
    expect(receipt.size).toBe(19)
    expect(receipt.sha256).toMatch(/^sha256:/u)

    const bytes = await backend.readFile(sb.id, "src/app.ts")
    expect(new TextDecoder().decode(bytes)).toBe("export const x = 1\n")

    const entries = await backend.listFiles(sb.id, "/workspace")
    const paths = entries.map((e) => e.path)
    expect(paths).toContain("/workspace/src")
    expect(entries.find((e) => e.path === "/workspace/src")?.type).toBe("dir")
  })

  test("exec simulates echo/cat/true/false against the workspace", async () => {
    const sb = await backend.create({})
    await backend.writeFile(sb.id, "note.txt", new TextEncoder().encode("hello-file"))

    const echo = await backend.exec(sb.id, ["echo", "hi", "there"])
    expect(echo.exit_code).toBe(0)
    expect(echo.stdout).toBe("hi there\n")

    const cat = await backend.exec(sb.id, ["cat", "note.txt"])
    expect(cat.exit_code).toBe(0)
    expect(cat.stdout).toBe("hello-file")

    expect((await backend.exec(sb.id, ["true"])).exit_code).toBe(0)
    expect((await backend.exec(sb.id, ["false"])).exit_code).toBe(1)
    expect((await backend.exec(sb.id, ["cat", "missing.txt"])).exit_code).toBe(1)
  })

  test("expose port, snapshot, keep-alive, stop, logs", async () => {
    const sb = await backend.create({})
    const port = await backend.exposePort(sb.id, 8080)
    expect(port.port).toBe(8080)
    expect(port.url).toContain("8080")
    expect((await backend.listExposedPorts(sb.id)).length).toBe(1)

    const snap = await backend.snapshot(sb.id)
    expect(snap.sandbox_id).toBe(sb.id)
    expect(snap.ref).toMatch(/^sha256:/u)

    const alive = await backend.keepAlive(sb.id, 60_000)
    expect(alive.expires_at).not.toBeNull()

    const stopped = await backend.stop(sb.id)
    expect(stopped.status).toBe("stopped")

    const logs = await backend.getLogs(sb.id)
    expect(logs.some((l) => l.event === "create")).toBe(true)
    expect(logs.some((l) => l.event === "expose_port")).toBe(true)
  })

  test("operations on a missing sandbox reject", async () => {
    await expect(backend.exec("nope", ["echo", "x"])).rejects.toBeInstanceOf(SandboxNotFoundError)
    await expect(backend.destroy("nope")).rejects.toBeInstanceOf(SandboxNotFoundError)
  })
})
