import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { getDbPath, resolveServerBackend } from "./database.js"
import {
  resolvePromptsClientTransport,
  assertNoRetiredPromptsStorageSelector,
  RetiredPromptsStorageSelectorError,
  PROMPTS_API_URL_ENV,
  PROMPTS_API_KEY_ENV,
} from "../client-transport.js"

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
  let originalApiUrl: string | undefined
  let originalApiKey: string | undefined
  let originalDatabaseUrl: string | undefined
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
    originalApiUrl = process.env[PROMPTS_API_URL_ENV]
    originalApiKey = process.env[PROMPTS_API_KEY_ENV]
    originalDatabaseUrl = process.env["HASNA_PROMPTS_DATABASE_URL"]
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
    delete process.env[PROMPTS_API_URL_ENV]
    delete process.env[PROMPTS_API_KEY_ENV]
    delete process.env["HASNA_PROMPTS_DATABASE_URL"]
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
    restoreEnv(PROMPTS_API_URL_ENV, originalApiUrl)
    restoreEnv(PROMPTS_API_KEY_ENV, originalApiKey)
    restoreEnv("HASNA_PROMPTS_DATABASE_URL", originalDatabaseUrl)
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

  test("server backend defaults to sqlite without HASNA_PROMPTS_DATABASE_URL", () => {
    expect(resolveServerBackend()).toBe("sqlite")
  })

  test("server backend selects postgresql with HASNA_PROMPTS_DATABASE_URL", () => {
    process.env["HASNA_PROMPTS_DATABASE_URL"] = "postgres://example/db"
    expect(resolveServerBackend()).toBe("postgresql")
  })

  test("retired storage-mode variables fail loudly even when blank", () => {
    process.env["HASNA_PROMPTS_STORAGE_MODE"] = ""
    expect(() => assertNoRetiredPromptsStorageSelector(process.env)).toThrow(RetiredPromptsStorageSelectorError)
    expect(() => resolvePromptsClientTransport(process.env)).toThrow(RetiredPromptsStorageSelectorError)
  })

  test("retired legacy storage-mode variable fails loudly", () => {
    process.env["PROMPTS_STORAGE_MODE"] = "local"
    expect(() => resolvePromptsClientTransport(process.env)).toThrow(RetiredPromptsStorageSelectorError)
  })

  test("retired registry diagnostics variables fail loudly", () => {
    process.env["PROMPTS_REGISTRY_POSTGRES_URL"] = "configured-postgres-url"
    expect(() => resolvePromptsClientTransport(process.env)).toThrow(RetiredPromptsStorageSelectorError)
    process.env["PROMPTS_REGISTRY_POSTGRES_URL"] = ""
    process.env["PROMPTS_REGISTRY_S3_BUCKET"] = "configured-bucket"
    expect(() => resolvePromptsClientTransport(process.env)).toThrow(RetiredPromptsStorageSelectorError)
  })

  test("client transport defaults to sqlite without the API URL", () => {
    const report = resolvePromptsClientTransport()
    expect(report.transport).toBe("sqlite")
    expect(report.api_url_present).toBe(false)
    expect(report.api_key_present).toBe(false)
  })

  test("API URL without its key fails closed", () => {
    process.env[PROMPTS_API_URL_ENV] = "http://localhost:19430"
    expect(() => resolvePromptsClientTransport()).toThrow(/missing/)
  })

  test("API URL with its key selects http", () => {
    process.env[PROMPTS_API_URL_ENV] = "http://localhost:19430"
    process.env[PROMPTS_API_KEY_ENV] = "hasna_prompts_test"
    const report = resolvePromptsClientTransport()
    expect(report.transport).toBe("http")
    expect(report.source).toBe(PROMPTS_API_URL_ENV)
  })

  test("diagnostics do not migrate legacy home directory", () => {
    const home = join(tempRoot, "home")
    const legacyDir = join(home, ".prompts")
    const targetDir = join(home, ".hasna", "prompts")
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, "prompts.db"), "legacy-db")
    process.env["HOME"] = home

    expect(getDbPath({ migrateLegacy: false })).toBe(join(targetDir, "prompts.db"))
    expect(existsSync(join(targetDir, "prompts.db"))).toBe(false)
    expect(readFileSync(join(legacyDir, "prompts.db"), "utf8")).toBe("legacy-db")
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
