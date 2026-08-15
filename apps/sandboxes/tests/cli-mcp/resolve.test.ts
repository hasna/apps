import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isSandboxProvider, resolveBackend, SANDBOX_PROVIDERS } from "../../src/runtime/resolve"
import { LocalSandboxBackend } from "../../src/runtime/local-backend"
import { MissingCredentialsError } from "../../src/runtime/types"

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sbx-resolve-"))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe("provider resolution + credential loading", () => {
  test("providers enumerated correctly", () => {
    expect([...SANDBOX_PROVIDERS]).toEqual(["local", "e2b", "daytona"])
    expect(isSandboxProvider("e2b")).toBe(true)
    expect(isSandboxProvider("nope")).toBe(false)
  })

  test("local resolves to a local backend", async () => {
    const backend = await resolveBackend("local", { home, env: {} })
    expect(backend).toBeInstanceOf(LocalSandboxBackend)
    expect(backend.provider).toBe("local")
  })

  test("e2b without credentials throws MissingCredentialsError (no network)", async () => {
    await expect(resolveBackend("e2b", { env: {}, secretsReader: () => undefined })).rejects.toBeInstanceOf(
      MissingCredentialsError,
    )
  })

  test("daytona without credentials throws MissingCredentialsError (no network)", async () => {
    await expect(resolveBackend("daytona", { env: {}, secretsReader: () => undefined })).rejects.toBeInstanceOf(
      MissingCredentialsError,
    )
  })

  test("credentials read from env produce a live backend object without connecting", async () => {
    const backend = await resolveBackend("e2b", { env: { E2B_API_KEY: "test-key-not-real" }, secretsReader: () => undefined })
    expect(backend.provider).toBe("e2b")
  })

  test("credentials fall back to the secrets reader when env is absent", async () => {
    let requested = ""
    const backend = await resolveBackend("e2b", {
      env: {},
      secretsReader: (name) => {
        requested = name
        return "from-vault-not-real"
      },
    })
    expect(backend.provider).toBe("e2b")
    expect(requested).toBe("E2B_API_KEY")
  })
})
