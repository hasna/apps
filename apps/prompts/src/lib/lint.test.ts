import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase } from "../db/database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { lintPrompt, lintAll } from "./lint.js"
import type { Prompt } from "../types/index.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "prmt-test01",
    name: "test-prompt",
    slug: "test-prompt",
    title: "Test Prompt",
    body: "This is a sufficiently long body for testing purposes.",
    description: "A test prompt",
    collection: "other",
    tags: ["tag1"],
    variables: [],
    is_template: false,
    source: "manual",
    version: 1,
    use_count: 1,
    last_used_at: null,
    pinned: false,
    next_prompt: null,
    expires_at: null,
    project_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe("lintPrompt", () => {
  test("no issues for well-formed prompt", () => {
    const issues = lintPrompt(makePrompt())
    expect(issues).toHaveLength(0)
  })

  test("warns when description is missing", () => {
    const issues = lintPrompt(makePrompt({ description: null }))
    expect(issues.some((i) => i.rule === "missing-description")).toBe(true)
  })

  test("errors when body is too short", () => {
    const issues = lintPrompt(makePrompt({ body: "Hi" }))
    expect(issues.some((i) => i.rule === "body-too-short" && i.severity === "error")).toBe(true)
  })

  test("info when no tags", () => {
    const issues = lintPrompt(makePrompt({ tags: [] }))
    expect(issues.some((i) => i.rule === "no-tags" && i.severity === "info")).toBe(true)
  })

  test("warns on template with undocumented vars", () => {
    const issues = lintPrompt(
      makePrompt({
        is_template: true,
        variables: [{ name: "myvar", default: undefined, description: "" }],
      })
    )
    expect(issues.some((i) => i.rule === "undocumented-vars")).toBe(true)
  })

  test("no undocumented-vars warning when vars have descriptions", () => {
    const issues = lintPrompt(
      makePrompt({
        is_template: true,
        variables: [{ name: "myvar", default: undefined, description: "My variable" }],
      })
    )
    expect(issues.some((i) => i.rule === "undocumented-vars")).toBe(false)
  })

  test("info when in default collection and never used", () => {
    const issues = lintPrompt(makePrompt({ collection: "default", use_count: 0 }))
    expect(issues.some((i) => i.rule === "uncollected")).toBe(true)
  })

  test("no uncollected info when used", () => {
    const issues = lintPrompt(makePrompt({ collection: "default", use_count: 5 }))
    expect(issues.some((i) => i.rule === "uncollected")).toBe(false)
  })
})

describe("lintAll", () => {
  test("filters out prompts with no issues", () => {
    const prompts = [makePrompt(), makePrompt({ description: null, id: "prmt-test02", slug: "test-2" })]
    const results = lintAll(prompts)
    expect(results).toHaveLength(1)
    expect(results[0]!.prompt.slug).toBe("test-2")
  })

  test("returns empty array for all-clean prompts", () => {
    expect(lintAll([makePrompt()])).toHaveLength(0)
  })

  test("includes all issues per prompt", () => {
    const bad = makePrompt({ description: null, tags: [], body: "Hi" })
    const results = lintAll([bad])
    expect(results[0]!.issues.length).toBeGreaterThan(1)
  })
})
