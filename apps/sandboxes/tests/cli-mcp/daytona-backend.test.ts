/**
 * Hermetic coverage for the live Daytona runtime backend's file-listing surface.
 *
 * The real `@daytona/sdk` is never loaded: we register a faked module (no
 * network, no credentials) via `mock.module` whose `executeCommand` runs the
 * backend's wire command through a REAL local `sh` against a temp directory —
 * exactly what the Daytona guest shell would do. That proves the generated
 * `find`/base64 listing script end-to-end: directories are reported as
 * `type: "dir"` (they used to be hardcoded `"file"`), and filenames containing
 * newlines survive intact instead of being split into phantom entries.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test, mock } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Every command the backend sends over the (faked) wire, for shape assertions.
let sentCommands: string[] = []

// Faithful stand-in for the SDK: `executeCommand(cmd)` executes the command
// string with a real POSIX shell, mirroring the guest-side execution model.
function fakeSandbox(id: string): Record<string, unknown> {
  return {
    id,
    process: {
      async executeCommand(cmd: string, cwd?: string) {
        sentCommands.push(cmd)
        const proc = Bun.spawnSync(["sh", "-c", cmd], cwd === undefined ? {} : { cwd })
        return {
          exitCode: proc.exitCode,
          artifacts: { stdout: new TextDecoder().decode(proc.stdout) },
        }
      },
    },
    async getPreviewLink() {
      throw new Error("not under test")
    },
    async delete() {},
  }
}

mock.module("@daytona/sdk", () => ({
  Daytona: class {
    constructor(_cfg: { apiKey?: string }) {}
    async get(id: string) {
      return fakeSandbox(id)
    }
  },
}))

// The backend imports "@daytona/sdk" lazily inside its methods, so a normal
// static import here is safe — the mock above is registered before any call.
const { createDaytonaBackend } = await import("../../src/runtime/daytona-backend")

// `mock.module` is process-global in Bun; restore after this file so the faked
// SDK can never leak into a later test file.
afterAll(() => {
  mock.restore()
})

let dir: string

beforeEach(() => {
  sentCommands = []
  dir = mkdtempSync(join(tmpdir(), "sbx-daytona-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const backend = createDaytonaBackend({ apiKey: "fake-api-key-for-hermetic-tests" })

describe("daytona runtime backend — listFiles (hermetic, faked SDK + real shell)", () => {
  test("directories are reported as type 'dir', files as 'file' (regression: everything was 'file')", async () => {
    mkdirSync(join(dir, "subdir"))
    writeFileSync(join(dir, "plain.txt"), "hello")

    const entries = await backend.listFiles("sbx_1", dir)

    expect(entries).toEqual([
      { path: join(dir, "plain.txt"), type: "file", size: null },
      { path: join(dir, "subdir"), type: "dir", size: null },
    ])
  })

  test("a filename containing a newline is one entry, not phantom split lines", async () => {
    const evil = "evil\nname.txt"
    writeFileSync(join(dir, evil), "")

    const entries = await backend.listFiles("sbx_1", dir)

    expect(entries).toEqual([{ path: join(dir, evil), type: "file", size: null }])
  })

  test("an empty directory lists as [] and a trailing slash on the path is tolerated", async () => {
    expect(await backend.listFiles("sbx_1", `${dir}/`)).toEqual([])
    // The wire command must quote/target the normalized base path, not "<dir>//".
    expect(sentCommands.at(-1)).toContain("find ")
    expect(sentCommands.at(-1)).not.toContain(`${dir}//`)
  })

  test("hidden entries and spaced names are listed with full paths", async () => {
    writeFileSync(join(dir, ".hidden"), "")
    writeFileSync(join(dir, "a file.txt"), "")
    mkdirSync(join(dir, "a dir"))

    const entries = await backend.listFiles("sbx_1", dir)

    expect(entries).toEqual([
      { path: join(dir, ".hidden"), type: "file", size: null },
      { path: join(dir, "a dir"), type: "dir", size: null },
      { path: join(dir, "a file.txt"), type: "file", size: null },
    ])
  })
})
