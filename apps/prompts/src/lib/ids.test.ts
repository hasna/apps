import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase } from "../db/database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { generateSlug, uniqueSlug, generatePromptId, generateId } from "./ids.js"
import { createPrompt } from "../db/prompts.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("generateSlug", () => {
  test("lowercases and hyphenates", () => {
    expect(generateSlug("Hello World")).toBe("hello-world")
  })

  test("removes special characters", () => {
    expect(generateSlug("Hello, World!")).toBe("hello-world")
  })

  test("collapses multiple spaces/hyphens", () => {
    expect(generateSlug("foo  bar")).toBe("foo-bar")
  })

  test("trims whitespace", () => {
    expect(generateSlug("  hello  ")).toBe("hello")
  })

  test("truncates at 80 chars", () => {
    const long = "a ".repeat(50)
    expect(generateSlug(long).length).toBeLessThanOrEqual(80)
  })

  test("handles empty string", () => {
    expect(generateSlug("")).toBe("")
  })
})

describe("uniqueSlug", () => {
  test("returns base slug when no collision", () => {
    expect(uniqueSlug("my-prompt")).toBe("my-prompt")
  })

  test("appends -2 on collision", () => {
    createPrompt({ title: "My Prompt", body: "test", slug: "my-prompt" })
    expect(uniqueSlug("my-prompt")).toBe("my-prompt-2")
  })

  test("increments suffix for multiple collisions", () => {
    createPrompt({ title: "My Prompt", body: "test", slug: "foo" })
    createPrompt({ title: "My Prompt 2", body: "test", slug: "foo-2" })
    expect(uniqueSlug("foo")).toBe("foo-3")
  })
})

describe("generateId", () => {
  test("returns id with given prefix", () => {
    const id = generateId("TEST")
    expect(id).toMatch(/^TEST-[a-z0-9]{8}$/)
  })

  test("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("X")))
    expect(ids.size).toBe(100)
  })
})

describe("generatePromptId", () => {
  test("returns prmt-prefixed id", () => {
    const id = generatePromptId()
    expect(id).toMatch(/^prmt-[a-z0-9]{8}$/)
  })

  test("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generatePromptId()))
    expect(ids.size).toBe(50)
  })
})
