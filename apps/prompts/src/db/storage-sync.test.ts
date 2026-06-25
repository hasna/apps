import { afterEach, describe, expect, it } from "bun:test"
import {
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  getStorageDatabaseEnvName,
  getStorageConfig,
  getStorageDatabaseUrl,
} from "./storage-config.js"
import { STORAGE_TABLES, parseStorageTables } from "./storage-sync.js"

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...STORAGE_MODE_ENV,
] as const

afterEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name]
  }
})

describe("prompts storage configuration", () => {
  it("prefers canonical storage database envs over fallback envs", () => {
    process.env["HASNA_PROMPTS_DATABASE_URL"] = "postgres://new.example/prompts"
    process.env["PROMPTS_DATABASE_URL"] = "postgres://fallback.example/prompts"

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/prompts")
    expect(getStorageDatabaseEnvName()).toBe("HASNA_PROMPTS_DATABASE_URL")
  })

  it("uses service storage database env as fallback", () => {
    process.env["PROMPTS_DATABASE_URL"] = "postgres://fallback.example/prompts"

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback.example/prompts")
    expect(getStorageDatabaseEnvName()).toBe("PROMPTS_DATABASE_URL")
  })

  it("uses storage mode envs", () => {
    process.env["HASNA_PROMPTS_STORAGE_MODE"] = "remote"

    expect(getStorageConfig().mode).toBe("remote")
  })

  it("returns all storage tables by default", () => {
    expect(parseStorageTables()).toEqual([...STORAGE_TABLES])
    expect(parseStorageTables("prompts,feedback")).toEqual(["prompts", "feedback"])
    expect(() => parseStorageTables("missing")).toThrow("Unknown prompts storage table")
  })
})
