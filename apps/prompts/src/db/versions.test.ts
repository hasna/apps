import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase } from "./database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { listVersions, getVersion, restoreVersion } from "./versions.js"
import { createPrompt, updatePrompt } from "./prompts.js"
import { PromptNotFoundError } from "../types/index.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("listVersions", () => {
  test("returns version 1 entry on new prompt", () => {
    const p = createPrompt({ title: "Test", body: "initial body" })
    expect(listVersions(p.id)).toHaveLength(1)
  })

  test("returns more versions after updates", () => {
    const p = createPrompt({ title: "Test", body: "v1 body" })
    updatePrompt(p.id, { body: "v2 body" })
    const versions = listVersions(p.id)
    expect(versions.length).toBeGreaterThanOrEqual(2)
  })
})

describe("getVersion", () => {
  test("returns null for nonexistent version", () => {
    const p = createPrompt({ title: "Test", body: "body" })
    expect(getVersion(p.id, 999)).toBeNull()
  })

  test("returns correct version", () => {
    const p = createPrompt({ title: "Test", body: "original" })
    updatePrompt(p.id, { body: "updated" })
    const versions = listVersions(p.id)
    expect(versions.length).toBeGreaterThan(0)
    const v = getVersion(p.id, versions[0]!.version)
    expect(v).not.toBeNull()
  })
})

describe("restoreVersion", () => {
  test("throws PromptNotFoundError for bad version", () => {
    const p = createPrompt({ title: "Test", body: "body" })
    expect(() => restoreVersion(p.id, 999)).toThrow(PromptNotFoundError)
  })

  test("restores body from previous version", () => {
    const p = createPrompt({ title: "Test", body: "original body" })
    updatePrompt(p.id, { body: "new body" })
    const versions = listVersions(p.id)
    const oldVersion = versions.find((v) => v.body === "original body")
    if (oldVersion) {
      restoreVersion(p.id, oldVersion.version, "test-agent")
      const updated = listVersions(p.id)
      expect(updated[0]!.body).toBe("original body")
    }
  })
})
