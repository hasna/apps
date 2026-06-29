import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { getDbPath, resolveStorageMode } from "./database.js"

describe("database path resolution", () => {
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalDbPath: string | undefined
  let originalHasnaDbPath: string | undefined
  let originalScope: string | undefined
  let originalStorageMode: string | undefined
  let originalLegacyStorageMode: string | undefined
  let originalCwd: string
  let tempRoot: string

  beforeEach(() => {
    originalHome = process.env["HOME"]
    originalUserProfile = process.env["USERPROFILE"]
    originalDbPath = process.env["PROMPTS_DB_PATH"]
    originalHasnaDbPath = process.env["HASNA_PROMPTS_DB_PATH"]
    originalScope = process.env["PROMPTS_DB_SCOPE"]
    originalStorageMode = process.env["HASNA_PROMPTS_STORAGE_MODE"]
    originalLegacyStorageMode = process.env["PROMPTS_STORAGE_MODE"]
    originalCwd = process.cwd()
    tempRoot = mkdtempSync(join(tmpdir(), "prompts-db-"))
    delete process.env["PROMPTS_DB_PATH"]
    delete process.env["HASNA_PROMPTS_DB_PATH"]
    delete process.env["USERPROFILE"]
    delete process.env["PROMPTS_DB_SCOPE"]
    delete process.env["HASNA_PROMPTS_STORAGE_MODE"]
    delete process.env["PROMPTS_STORAGE_MODE"]
  })

  afterEach(() => {
    process.chdir(originalCwd)
    restoreEnv("HOME", originalHome)
    restoreEnv("USERPROFILE", originalUserProfile)
    restoreEnv("PROMPTS_DB_PATH", originalDbPath)
    restoreEnv("HASNA_PROMPTS_DB_PATH", originalHasnaDbPath)
    restoreEnv("PROMPTS_DB_SCOPE", originalScope)
    restoreEnv("HASNA_PROMPTS_STORAGE_MODE", originalStorageMode)
    restoreEnv("PROMPTS_STORAGE_MODE", originalLegacyStorageMode)
    rmSync(tempRoot, { recursive: true, force: true })
  })

  test("merges legacy home directory into an existing ~/.hasna/prompts directory", () => {
    const home = join(tempRoot, "home")
    const legacyDir = join(home, ".prompts")
    const targetDir = join(home, ".hasna", "prompts")
    mkdirSync(join(legacyDir, "collections"), { recursive: true })
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(legacyDir, "prompts.db"), "legacy-db")
    writeFileSync(join(legacyDir, "collections", "default.json"), "legacy-collection")
    writeFileSync(join(targetDir, "config.json"), "new-config")
    writeFileSync(join(legacyDir, "config.json"), "legacy-config")
    process.env["HOME"] = home

    expect(getDbPath()).toBe(join(targetDir, "prompts.db"))

    expect(readFileSync(join(targetDir, "prompts.db"), "utf8")).toBe("legacy-db")
    expect(readFileSync(join(targetDir, "collections", "default.json"), "utf8")).toBe("legacy-collection")
    expect(readFileSync(join(targetDir, "config.json"), "utf8")).toBe("new-config")
    expect(existsSync(legacyDir)).toBe(true)
  })

  test("project scope keeps project-local .prompts ahead of home migration", () => {
    const home = join(tempRoot, "home")
    const project = join(home, "workspace", "project")
    const projectDb = join(project, ".prompts", "prompts.db")
    mkdirSync(join(project, ".git"), { recursive: true })
    mkdirSync(join(home, ".prompts"), { recursive: true })
    writeFileSync(join(home, ".prompts", "prompts.db"), "legacy-db")
    process.env["HOME"] = home
    process.env["PROMPTS_DB_SCOPE"] = "project"
    process.chdir(project)

    expect(getDbPath()).toBe(projectDb)
    expect(existsSync(join(home, ".hasna", "prompts", "prompts.db"))).toBe(false)
  })

  test("rejects unsupported storage modes", () => {
    process.env["HASNA_PROMPTS_STORAGE_MODE"] = "shared"

    expect(() => resolveStorageMode()).toThrow("Unsupported prompts storage mode")
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
