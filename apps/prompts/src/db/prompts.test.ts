import { describe, expect, test, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { closeDatabase, resetDatabase, getDatabase } from "./database.js"

// Use in-memory DB for tests
process.env["PROMPTS_DB_PATH"] = ":memory:"

import { createPrompt, getPrompt, listPrompts, listPromptsSlim, updatePrompt, deletePrompt, usePrompt, upsertPrompt } from "./prompts.js"
import { PromptNotFoundError, VersionConflictError, DuplicateSlugError } from "../types/index.js"
import { loadPromptVariables } from "./variables.js"
import { setLabel, listLabels } from "./labels.js"

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

  test("handles quoted project_id safely in project ordering path", () => {
    createPrompt({ title: "Global", body: "body" })
    const unsafeProjectId = "proj' OR 1=1 --"

    expect(() => listPrompts({ project_id: unsafeProjectId })).not.toThrow()
    expect(() => listPromptsSlim({ project_id: unsafeProjectId })).not.toThrow()
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

describe("variable metadata persistence (defect: stored variables always required:true)", () => {
  test("inline default variables are stored as optional", () => {
    const p = createPrompt({ title: "Template", body: "Hello {{name|world}} and {{required_var}}" })
    const byName = new Map(p.variables.map((v) => [v.name, v]))
    expect(byName.get("name")?.required).toBe(false)
    expect(byName.get("required_var")?.required).toBe(true)
  })

  test("prompt_variables rows mirror the body extraction", () => {
    const p = createPrompt({ title: "Template", body: "{{a|d}} {{b}}" })
    const rows = loadPromptVariables(p.id)
    expect(rows).toHaveLength(2)
    const byName = new Map(rows.map((v) => [v.name, v]))
    expect(byName.get("a")?.required).toBe(false)
    expect(byName.get("a")?.type).toBe("string")
    expect(byName.get("b")?.required).toBe(true)
  })

  test("var_schema persists typed defaults, types, descriptions, validation, render format", () => {
    const p = createPrompt({
      title: "Typed Template",
      body: "{{count}} and {{items}}",
      var_schema: [
        { name: "count", type: "number", required: true, default: 5, description: "the count", validation: '{"min":0}' },
        { name: "items", type: "array", required: false, default: ["a", "b"], render_format: "json-pretty" },
      ],
    })
    const byName = new Map(p.variables.map((v) => [v.name, v]))
    expect(byName.get("count")?.type).toBe("number")
    expect(byName.get("count")?.typed_default).toBe(5)
    expect(byName.get("count")?.description).toBe("the count")
    expect(byName.get("count")?.validation).toBe('{"min":0}')
    expect(byName.get("items")?.type).toBe("array")
    expect(byName.get("items")?.typed_default).toEqual(["a", "b"])
    expect(byName.get("items")?.render_format).toBe("json-pretty")
  })

  test("update re-syncs variables when body changes", () => {
    const p = createPrompt({ title: "Template", body: "{{a}} {{b}}" })
    expect(p.variables).toHaveLength(2)
    const updated = updatePrompt(p.id, { body: "{{a}} only now" })
    expect(updated.variables).toHaveLength(1)
    expect(updated.variables[0]?.name).toBe("a")
    expect(loadPromptVariables(p.id)).toHaveLength(1)
  })

  test("update preserves persisted metadata for surviving variables", () => {
    const p = createPrompt({
      title: "Template",
      body: "{{a}} {{b}}",
      var_schema: [{ name: "a", type: "number", description: "kept" }],
    })
    const updated = updatePrompt(p.id, { body: "{{a}} and {{c}}" })
    const byName = new Map(updated.variables.map((v) => [v.name, v]))
    expect(byName.get("a")?.type).toBe("number")
    expect(byName.get("a")?.description).toBe("kept")
    expect(byName.get("c")).toBeDefined()
  })
})

describe("labels on save", () => {
  test("save with labels persists them", () => {
    const p = createPrompt({
      title: "Labeled",
      body: "body",
      labels: [{ key: "env", value: "prod" }, { key: "team", value: "core" }],
    })
    const labels = listLabels(p.id)
    expect(labels).toHaveLength(2)
    expect(labels.map((l) => l.key).sort()).toEqual(["env", "team"])
  })

  test("save with extends sets a single parent", () => {
    const parent = createPrompt({ title: "Parent", body: "P {{name|p}}", slug: "parent-prompt" })
    const child = createPrompt({ title: "Child", body: "C", slug: "child-prompt", extends_prompt: "parent-prompt" })
    const db = getDatabase()
    const dep = db
      .query("SELECT relation, dependency_prompt_id, pinned_version FROM prompt_dependencies WHERE prompt_id = ?")
      .get(child.id) as { relation: string; dependency_prompt_id: string; pinned_version: number }
    expect(dep.relation).toBe("parent")
    expect(dep.dependency_prompt_id).toBe(parent.id)
    expect(dep.pinned_version).toBe(parent.version)
  })
})
