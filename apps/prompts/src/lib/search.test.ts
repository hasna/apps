import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase } from "../db/database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { createPrompt } from "../db/prompts.js"
import { searchPrompts, findSimilar } from "./search.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("searchPrompts", () => {
  test("returns all prompts for empty query", () => {
    createPrompt({ title: "A", body: "body a" })
    createPrompt({ title: "B", body: "body b" })
    const results = searchPrompts("")
    expect(results.length).toBeGreaterThanOrEqual(2)
  })

  test("finds prompt by title keyword", () => {
    createPrompt({ title: "TypeScript Review", body: "Review this code" })
    createPrompt({ title: "Python Debug", body: "Debug this script" })
    const results = searchPrompts("TypeScript")
    expect(results.some((r) => r.prompt.slug === "typescript-review")).toBe(true)
  })

  test("finds prompt by body keyword", () => {
    createPrompt({ title: "Prompt 1", body: "unique-phrase-xyz in this body" })
    const results = searchPrompts("unique-phrase-xyz")
    expect(results).toHaveLength(1)
  })

  test("filters by collection", () => {
    createPrompt({ title: "C1", body: "body", collection: "alpha" })
    createPrompt({ title: "C2", body: "body", collection: "beta" })
    const results = searchPrompts("body", { collection: "alpha" })
    expect(results.every((r) => r.prompt.collection === "alpha")).toBe(true)
  })
})

describe("findSimilar", () => {
  test("finds prompts with shared tags", () => {
    const p1 = createPrompt({ title: "A", body: "body", tags: ["code", "review"] })
    const p2 = createPrompt({ title: "B", body: "body", tags: ["code", "typescript"] })
    createPrompt({ title: "C", body: "body", tags: ["marketing"] })
    const similar = findSimilar(p1.id, 5)
    expect(similar.some((r) => r.prompt.id === p2.id)).toBe(true)
  })

  test("returns empty for prompt with no tags and different collection", () => {
    const p1 = createPrompt({ title: "A", body: "body", collection: "x" })
    createPrompt({ title: "B", body: "body", collection: "y" })
    const similar = findSimilar(p1.id, 5)
    // No shared tags, different collection — score 0
    expect(similar.length).toBe(0)
  })
})
