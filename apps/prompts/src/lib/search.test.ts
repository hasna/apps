import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { createPrompt } from "../db/prompts.js"
import { searchPrompts, searchPromptsSlim, findSimilar } from "./search.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

function disableFts(): void {
  const db = getDatabase()
  db.exec(`
    DROP TRIGGER IF EXISTS prompts_fts_insert;
    DROP TRIGGER IF EXISTS prompts_fts_update;
    DROP TRIGGER IF EXISTS prompts_fts_delete;
    DROP TABLE IF EXISTS prompts_fts;
  `)
}

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

  test("applies collection and tag filters when falling back to LIKE search", () => {
    createPrompt({ title: "Alpha Tagged", body: "shared fallback target", collection: "alpha", tags: ["keep"] })
    createPrompt({ title: "Alpha Other Tag", body: "shared fallback target", collection: "alpha", tags: ["drop"] })
    createPrompt({ title: "Beta Tagged", body: "shared fallback target", collection: "beta", tags: ["keep"] })
    disableFts()

    const results = searchPrompts("shared fallback", { collection: "alpha", tags: ["keep"] })
    expect(results.map((r) => r.prompt.slug)).toEqual(["alpha-tagged"])
  })

  test("applies collection and tag filters in slim LIKE search", () => {
    createPrompt({ title: "Alpha Slim Tagged", body: "shared slim fallback target", collection: "alpha", tags: ["keep"] })
    createPrompt({ title: "Alpha Slim Other Tag", body: "shared slim fallback target", collection: "alpha", tags: ["drop"] })
    createPrompt({ title: "Beta Slim Tagged", body: "shared slim fallback target", collection: "beta", tags: ["keep"] })
    disableFts()

    const results = searchPromptsSlim("shared slim fallback", { collection: "alpha", tags: ["keep"] })
    expect(results.map((r) => r.slug)).toEqual(["alpha-slim-tagged"])
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
