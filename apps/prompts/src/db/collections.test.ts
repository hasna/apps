import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase } from "./database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { listCollections, getCollection, ensureCollection, movePrompt } from "./collections.js"
import { createPrompt } from "./prompts.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("listCollections", () => {
  test("returns default collection on empty db", () => {
    const cols = listCollections()
    expect(cols.some((c) => c.name === "default")).toBe(true)
  })

  test("includes prompt_count", () => {
    createPrompt({ title: "Test", body: "test body here" })
    const cols = listCollections()
    const def = cols.find((c) => c.name === "default")!
    expect(def.prompt_count).toBe(1)
  })
})

describe("getCollection", () => {
  test("returns null for unknown collection", () => {
    expect(getCollection("nonexistent")).toBeNull()
  })

  test("returns default collection", () => {
    const col = getCollection("default")
    expect(col).not.toBeNull()
    expect(col!.name).toBe("default")
  })
})

describe("ensureCollection", () => {
  test("creates new collection", () => {
    const col = ensureCollection("my-collection", "My description")
    expect(col.name).toBe("my-collection")
    expect(col.description).toBe("My description")
  })

  test("returns existing collection without error", () => {
    ensureCollection("dup-col")
    const col = ensureCollection("dup-col")
    expect(col.name).toBe("dup-col")
  })
})

describe("movePrompt", () => {
  test("moves prompt to new collection", () => {
    const p = createPrompt({ title: "My Prompt", body: "test body here" })
    movePrompt(p.id, "work")
    const col = getCollection("work")!
    expect(col.prompt_count).toBe(1)
  })

  test("moves prompt by slug", () => {
    const p = createPrompt({ title: "My Prompt", body: "test body here" })
    movePrompt(p.slug, "personal")
    expect(getCollection("personal")!.prompt_count).toBe(1)
  })

  test("throws on unknown prompt", () => {
    expect(() => movePrompt("ghost-slug", "work")).toThrow()
  })
})
