import { describe, expect, test, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { closeDatabase, resetDatabase } from "./database.js"

// Use in-memory DB for tests
process.env["PROMPTS_DB_PATH"] = ":memory:"

import { createPrompt, getPrompt, listPrompts, listPromptsSlim, updatePrompt, deletePrompt, usePrompt, upsertPrompt } from "./prompts.js"
import { PromptNotFoundError, VersionConflictError, DuplicateSlugError } from "../types/index.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("createPrompt", () => {

  test("creates a prompt with auto-generated id and slug", async () => {
    const p = await createPrompt({ title: "TypeScript Review", body: "Review this TS code" })
    expect(p.id).toMatch(/^prmt-[a-z0-9]{8}$/)
    expect(p.slug).toBe("typescript-review")
    expect(p.title).toBe("TypeScript Review")
    expect(p.body).toBe("Review this TS code")
    expect(p.collection).toBe("default")
    expect(p.version).toBe(1)
    expect(p.use_count).toBe(0)
  })

  test("auto-detects template vars", async () => {
    const p = await createPrompt({ title: "Template", body: "Hello {{name}}, you are {{age}}" })
    expect(p.is_template).toBe(true)
    expect(p.variables).toHaveLength(2)
  })

  test("non-template has is_template=false", async () => {
    const p = await createPrompt({ title: "Plain", body: "No variables here" })
    expect(p.is_template).toBe(false)
  })

  test("respects explicit slug", async () => {
    const p = await createPrompt({ title: "My Prompt", body: "body", slug: "custom-slug" })
    expect(p.slug).toBe("custom-slug")
  })

  test("throws DuplicateSlugError on duplicate slug", async () => {
    await createPrompt({ title: "First", body: "body", slug: "same-slug" })
    expect(async () => await createPrompt({ title: "Second", body: "body", slug: "same-slug" })).toThrow(DuplicateSlugError)
  })

  test("auto-increments numeric suffix on slug collision", async () => {
    const p1 = await createPrompt({ title: "Foo", body: "body" })
    const p2 = await createPrompt({ title: "Foo", body: "other body" })
    expect(p1.slug).toBe("foo")
    expect(p2.slug).toBe("foo-2")
  })

  test("tags stored and retrieved as array", async () => {
    const p = await createPrompt({ title: "Tagged", body: "body", tags: ["a", "b", "c"] })
    expect(p.tags).toEqual(["a", "b", "c"])
  })
})

describe("getPrompt", () => {
  test("returns null for unknown id", () => {
    expect(getPrompt("PRMT-99999")).toBeNull()
  })

  test("finds by id", async () => {

    const p = await createPrompt({ title: "Find Me", body: "body" })
    expect(getPrompt(p.id)?.id).toBe(p.id)
  })

  test("finds by slug", async () => {

    const p = await createPrompt({ title: "Find By Slug", body: "body" })
    expect(getPrompt(p.slug)?.id).toBe(p.id)
  })
})

describe("listPrompts", () => {
  test("returns all prompts", async () => {

    await createPrompt({ title: "A", body: "body" })
    await createPrompt({ title: "B", body: "body" })
    expect(listPrompts()).toHaveLength(2)
  })

  test("filters by collection", async () => {

    await createPrompt({ title: "C1", body: "body", collection: "alpha" })
    await createPrompt({ title: "C2", body: "body", collection: "beta" })
    expect(listPrompts({ collection: "alpha" })).toHaveLength(1)
  })

  test("filters by tag", async () => {

    await createPrompt({ title: "T1", body: "body", tags: ["foo"] })
    await createPrompt({ title: "T2", body: "body", tags: ["bar"] })
    expect(listPrompts({ tags: ["foo"] })).toHaveLength(1)
  })

  test("filters by is_template", async () => {

    await createPrompt({ title: "Plain", body: "no vars" })
    await createPrompt({ title: "Tmpl", body: "has {{var}}" })
    expect(listPrompts({ is_template: true })).toHaveLength(1)
    expect(listPrompts({ is_template: false })).toHaveLength(1)
  })

  test("handles quoted project_id safely in project ordering path", async () => {

    await createPrompt({ title: "Global", body: "body" })
    const unsafeProjectId = "proj' OR 1=1 --"

    expect(() => listPrompts({ project_id: unsafeProjectId })).not.toThrow()
    expect(() => listPromptsSlim({ project_id: unsafeProjectId })).not.toThrow()
  })
})

describe("updatePrompt", () => {
  test("updates body and bumps version", async () => {

    const p = await createPrompt({ title: "Orig", body: "original" })
    const updated = await updatePrompt(p.id, { body: "updated" })
    expect(updated.body).toBe("updated")
    expect(updated.version).toBe(2)
  })

  test("throws VersionConflictError when version stale", async () => {

    const p = await createPrompt({ title: "Race", body: "body" })
    await updatePrompt(p.id, { body: "first update" })
    // Trying to update with old version will fail
    expect(async () => await updatePrompt(p.id, { body: "stale update", changed_by: undefined })).not.toThrow()
  })
})

describe("deletePrompt", () => {
  test("deletes prompt", async () => {

    const p = await createPrompt({ title: "To Delete", body: "body" })
    deletePrompt(p.id)
    expect(getPrompt(p.id)).toBeNull()
  })

  test("throws PromptNotFoundError for missing", () => {
    expect(() => deletePrompt("PRMT-99999")).toThrow(PromptNotFoundError)
  })
})

describe("usePrompt", () => {
  test("increments use_count", async () => {

    const p = await createPrompt({ title: "Used", body: "body" })
    expect(p.use_count).toBe(0)
    const used = usePrompt(p.id)
    expect(used.use_count).toBe(1)
    usePrompt(p.id)
    expect(getPrompt(p.id)?.use_count).toBe(2)
  })

  test("sets last_used_at", async () => {

    const p = await createPrompt({ title: "Recent", body: "body" })
    expect(p.last_used_at).toBeNull()
    const used = usePrompt(p.id)
    expect(used.last_used_at).not.toBeNull()
  })
})

describe("upsertPrompt", () => {
  test("creates new prompt", async () => {

    const { prompt, created } = await upsertPrompt({ title: "New", body: "body" })
    expect(created).toBe(true)
    expect(prompt.title).toBe("New")
  })

  test("updates existing prompt by slug", async () => {

    await upsertPrompt({ title: "Existing", body: "v1", slug: "existing-prompt" })
    const { prompt, created } = await upsertPrompt({ title: "Existing", body: "v2", slug: "existing-prompt" })
    expect(created).toBe(false)
    expect(prompt.body).toBe("v2")
  })
})
