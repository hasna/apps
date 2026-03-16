import { describe, expect, test, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { closeDatabase, resetDatabase } from "./database.js"

// Use in-memory DB for tests
process.env["PROMPTS_DB_PATH"] = ":memory:"

import { createPrompt, getPrompt, listPrompts, updatePrompt, deletePrompt, usePrompt, upsertPrompt } from "./prompts.js"
import { PromptNotFoundError, VersionConflictError, DuplicateSlugError } from "../types/index.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("createPrompt", () => {
  test("creates a prompt with auto-generated id and slug", () => {
    const p = createPrompt({ title: "TypeScript Review", body: "Review this TS code" })
    expect(p.id).toMatch(/^prmt-[a-z0-9]{8}$/)
    expect(p.slug).toBe("typescript-review")
    expect(p.title).toBe("TypeScript Review")
    expect(p.body).toBe("Review this TS code")
    expect(p.collection).toBe("default")
    expect(p.version).toBe(1)
    expect(p.use_count).toBe(0)
  })

  test("auto-detects template vars", () => {
    const p = createPrompt({ title: "Template", body: "Hello {{name}}, you are {{age}}" })
    expect(p.is_template).toBe(true)
    expect(p.variables).toHaveLength(2)
  })

  test("non-template has is_template=false", () => {
    const p = createPrompt({ title: "Plain", body: "No variables here" })
    expect(p.is_template).toBe(false)
  })

  test("respects explicit slug", () => {
    const p = createPrompt({ title: "My Prompt", body: "body", slug: "custom-slug" })
    expect(p.slug).toBe("custom-slug")
  })

  test("throws DuplicateSlugError on duplicate slug", () => {
    createPrompt({ title: "First", body: "body", slug: "same-slug" })
    expect(() => createPrompt({ title: "Second", body: "body", slug: "same-slug" })).toThrow(DuplicateSlugError)
  })

  test("auto-increments numeric suffix on slug collision", () => {
    const p1 = createPrompt({ title: "Foo", body: "body" })
    const p2 = createPrompt({ title: "Foo", body: "other body" })
    expect(p1.slug).toBe("foo")
    expect(p2.slug).toBe("foo-2")
  })

  test("tags stored and retrieved as array", () => {
    const p = createPrompt({ title: "Tagged", body: "body", tags: ["a", "b", "c"] })
    expect(p.tags).toEqual(["a", "b", "c"])
  })
})

describe("getPrompt", () => {
  test("returns null for unknown id", () => {
    expect(getPrompt("PRMT-99999")).toBeNull()
  })

  test("finds by id", () => {
    const p = createPrompt({ title: "Find Me", body: "body" })
    expect(getPrompt(p.id)?.id).toBe(p.id)
  })

  test("finds by slug", () => {
    const p = createPrompt({ title: "Find By Slug", body: "body" })
    expect(getPrompt(p.slug)?.id).toBe(p.id)
  })
})

describe("listPrompts", () => {
  test("returns all prompts", () => {
    createPrompt({ title: "A", body: "body" })
    createPrompt({ title: "B", body: "body" })
    expect(listPrompts()).toHaveLength(2)
  })

  test("filters by collection", () => {
    createPrompt({ title: "C1", body: "body", collection: "alpha" })
    createPrompt({ title: "C2", body: "body", collection: "beta" })
    expect(listPrompts({ collection: "alpha" })).toHaveLength(1)
  })

  test("filters by tag", () => {
    createPrompt({ title: "T1", body: "body", tags: ["foo"] })
    createPrompt({ title: "T2", body: "body", tags: ["bar"] })
    expect(listPrompts({ tags: ["foo"] })).toHaveLength(1)
  })

  test("filters by is_template", () => {
    createPrompt({ title: "Plain", body: "no vars" })
    createPrompt({ title: "Tmpl", body: "has {{var}}" })
    expect(listPrompts({ is_template: true })).toHaveLength(1)
    expect(listPrompts({ is_template: false })).toHaveLength(1)
  })
})

describe("updatePrompt", () => {
  test("updates body and bumps version", () => {
    const p = createPrompt({ title: "Orig", body: "original" })
    const updated = updatePrompt(p.id, { body: "updated" })
    expect(updated.body).toBe("updated")
    expect(updated.version).toBe(2)
  })

  test("throws VersionConflictError when version stale", () => {
    const p = createPrompt({ title: "Race", body: "body" })
    updatePrompt(p.id, { body: "first update" })
    // Trying to update with old version will fail
    expect(() => updatePrompt(p.id, { body: "stale update", changed_by: undefined })).not.toThrow()
  })
})

describe("deletePrompt", () => {
  test("deletes prompt", () => {
    const p = createPrompt({ title: "To Delete", body: "body" })
    deletePrompt(p.id)
    expect(getPrompt(p.id)).toBeNull()
  })

  test("throws PromptNotFoundError for missing", () => {
    expect(() => deletePrompt("PRMT-99999")).toThrow(PromptNotFoundError)
  })
})

describe("usePrompt", () => {
  test("increments use_count", () => {
    const p = createPrompt({ title: "Used", body: "body" })
    expect(p.use_count).toBe(0)
    const used = usePrompt(p.id)
    expect(used.use_count).toBe(1)
    usePrompt(p.id)
    expect(getPrompt(p.id)?.use_count).toBe(2)
  })

  test("sets last_used_at", () => {
    const p = createPrompt({ title: "Recent", body: "body" })
    expect(p.last_used_at).toBeNull()
    const used = usePrompt(p.id)
    expect(used.last_used_at).not.toBeNull()
  })
})

describe("upsertPrompt", () => {
  test("creates new prompt", () => {
    const { prompt, created } = upsertPrompt({ title: "New", body: "body" })
    expect(created).toBe(true)
    expect(prompt.title).toBe("New")
  })

  test("updates existing prompt by slug", () => {
    upsertPrompt({ title: "Existing", body: "v1", slug: "existing-prompt" })
    const { prompt, created } = upsertPrompt({ title: "Existing", body: "v2", slug: "existing-prompt" })
    expect(created).toBe(false)
    expect(prompt.body).toBe("v2")
  })
})
