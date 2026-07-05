import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { getDbPath, getPromptRegistryDiagnostics, resolveStorageMode } from "./database.js"

describe("database path resolution", () => {
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalDbPath: string | undefined
  let originalHasnaDbPath: string | undefined
  let originalScope: string | undefined
  let originalStorageMode: string | undefined
  let originalLegacyStorageMode: string | undefined
  let originalRegistryPostgresUrl: string | undefined
  let originalRegistryS3Bucket: string | undefined
  let originalRegistryAwsRegion: string | undefined
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
    originalRegistryPostgresUrl = process.env["PROMPTS_REGISTRY_POSTGRES_URL"]
    originalRegistryS3Bucket = process.env["PROMPTS_REGISTRY_S3_BUCKET"]
    originalRegistryAwsRegion = process.env["PROMPTS_REGISTRY_AWS_REGION"]
    originalCwd = process.cwd()
    tempRoot = mkdtempSync(join(tmpdir(), "prompts-db-"))
    delete process.env["PROMPTS_DB_PATH"]
    delete process.env["HASNA_PROMPTS_DB_PATH"]
    delete process.env["USERPROFILE"]
    delete process.env["PROMPTS_DB_SCOPE"]
    delete process.env["HASNA_PROMPTS_STORAGE_MODE"]
    delete process.env["PROMPTS_STORAGE_MODE"]
    delete process.env["PROMPTS_REGISTRY_POSTGRES_URL"]
    delete process.env["PROMPTS_REGISTRY_S3_BUCKET"]
    delete process.env["PROMPTS_REGISTRY_AWS_REGION"]
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
    restoreEnv("PROMPTS_REGISTRY_POSTGRES_URL", originalRegistryPostgresUrl)
    restoreEnv("PROMPTS_REGISTRY_S3_BUCKET", originalRegistryS3Bucket)
    restoreEnv("PROMPTS_REGISTRY_AWS_REGION", originalRegistryAwsRegion)
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

  test("remote mode reports local fallback diagnostics without exposing configured values", () => {
    const home = join(tempRoot, "home")
    process.env["HOME"] = home
    process.env["HASNA_PROMPTS_STORAGE_MODE"] = "remote"
    process.env["PROMPTS_REGISTRY_POSTGRES_URL"] = "configured-postgres-url"
    process.env["PROMPTS_REGISTRY_S3_BUCKET"] = "configured-bucket"
    process.env["PROMPTS_REGISTRY_AWS_REGION"] = "configured-region"

    const diagnostics = getPromptRegistryDiagnostics()
    const serialized = JSON.stringify(diagnostics)

    expect(diagnostics.requested_mode).toBe("remote")
    expect(diagnostics.active_storage).toBe("local-sqlite")
    expect(diagnostics.registry_state).toBe("remote-configured-local-fallback")
    expect(diagnostics.local).toEqual({
      db_path: join(home, ".hasna", "prompts", "prompts.db"),
      scope: "home",
      storage: "SQLite",
    })
    expect(diagnostics.remote.postgres.configured).toBe(true)
    expect(diagnostics.remote.object_storage).toMatchObject({
      configured: true,
      provider: "s3",
      bucket_configured: true,
    })
    expect(diagnostics.remote.aws.region_configured).toBe(true)
    expect(diagnostics.sync).toMatchObject({
      strategy: "local-first",
      reads: "local SQLite",
      writes: "local SQLite",
      remote_mutation: false,
    })
    expect(serialized).not.toContain("configured-postgres-url")
    expect(serialized).not.toContain("configured-bucket")
    expect(serialized).not.toContain("configured-region")
  })

  test("auto mode stays local when remote registry configuration is absent", () => {
    process.env["HOME"] = join(tempRoot, "home")
    process.env["HASNA_PROMPTS_STORAGE_MODE"] = "auto"

    const diagnostics = getPromptRegistryDiagnostics()

    expect(diagnostics.requested_mode).toBe("auto")
    expect(diagnostics.registry_state).toBe("local-only")
    expect(diagnostics.remote.requested).toBe(false)
    expect(diagnostics.remote.configured).toBe(false)
    expect(diagnostics.warnings).toEqual([])
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
