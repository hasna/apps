import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase, getDatabase } from "./database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { createPrompt, getPrompt } from "./prompts.js"
import { setLabel, removeLabel, listLabels, normalizeLabelKey, normalizeLabelValue } from "./labels.js"
import { listPrompts } from "./prompts.js"
import { searchPrompts } from "../lib/search.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("label normalization", () => {
  test("keys are trimmed and lowercased", () => {
    expect(normalizeLabelKey("  Environment ")).toBe("environment")
    expect(normalizeLabelKey("ENV")).toBe("env")
  })

  test("values are trimmed and lowercased", () => {
    expect(normalizeLabelValue("  Production ")).toBe("production")
    expect(normalizeLabelValue("High")).toBe("high")
  })
})

describe("labels", () => {
  test("sets and lists a label", () => {
    const p = createPrompt({ title: "Labeled", body: "body" })
    setLabel(p.id, "environment", "production")
    const labels = listLabels(p.id)
    expect(labels).toHaveLength(1)
    expect(labels[0]?.key).toBe("environment")
    expect(labels[0]?.value).toBe("production")
    expect(labels[0]?.prompt_id).toBe(p.id)
  })

  test("setting the same key/value twice is idempotent", () => {
    const p = createPrompt({ title: "Labeled", body: "body" })
    setLabel(p.id, "env", "prod")
    setLabel(p.id, "env", "prod")
    expect(listLabels(p.id)).toHaveLength(1)
  })

  test("same key with different values are separate rows", () => {
    const p = createPrompt({ title: "Labeled", body: "body" })
    setLabel(p.id, "env", "prod")
    setLabel(p.id, "env", "staging")
    expect(listLabels(p.id)).toHaveLength(2)
  })

  test("remove deletes all values for a key", () => {
    const p = createPrompt({ title: "Labeled", body: "body" })
    setLabel(p.id, "env", "prod")
    setLabel(p.id, "env", "staging")
    removeLabel(p.id, "env")
    expect(listLabels(p.id)).toHaveLength(0)
  })

  test("labels are normalized on set", () => {
    const p = createPrompt({ title: "Labeled", body: "body" })
    setLabel(p.id, "  Environment ", " Production ")
    const labels = listLabels(p.id)
    expect(labels[0]?.key).toBe("environment")
    expect(labels[0]?.value).toBe("production")
  })

  test("deleting a prompt cascades to its labels", () => {
    const p = createPrompt({ title: "Labeled", body: "body" })
    setLabel(p.id, "env", "prod")
    const db = getDatabase()
    db.run("DELETE FROM prompts WHERE id = ?", [p.id])
    const count = (db.query("SELECT COUNT(*) as n FROM prompt_labels").get() as { n: number }).n
    expect(count).toBe(0)
  })
})

describe("label filters", () => {
  test("list filters by exact label", () => {
    const a = createPrompt({ title: "A", body: "body a", slug: "a" })
    const b = createPrompt({ title: "B", body: "body b", slug: "b" })
    setLabel(a.id, "env", "prod")
    setLabel(b.id, "env", "staging")

    const prod = listPrompts({ labels: [{ key: "env", value: "prod" }] })
    expect(prod.map((p) => p.id)).toEqual([a.id])

    const staging = listPrompts({ labels: [{ key: "env", value: "staging" }] })
    expect(staging.map((p) => p.id)).toEqual([b.id])

    // No match
    const none = listPrompts({ labels: [{ key: "env", value: "qa" }] })
    expect(none).toHaveLength(0)
  })

  test("multiple label filters combine with AND", () => {
    const a = createPrompt({ title: "A", body: "body a", slug: "a" })
    const b = createPrompt({ title: "B", body: "body b", slug: "b" })
    setLabel(a.id, "env", "prod")
    setLabel(a.id, "team", "core")
    setLabel(b.id, "env", "prod")

    const both = listPrompts({ labels: [{ key: "env", value: "prod" }, { key: "team", value: "core" }] })
    expect(both.map((p) => p.id)).toEqual([a.id])
  })

  test("slim list filters by exact label", () => {
    const a = createPrompt({ title: "A", body: "body a", slug: "a" })
    createPrompt({ title: "B", body: "body b", slug: "b" })
    setLabel(a.id, "env", "prod")
    const found = listPrompts({ labels: [{ key: "env", value: "prod" }] })
    expect(found.map((p) => p.slug)).toEqual(["a"])
  })

  test("search filters by exact label", () => {
    const a = createPrompt({ title: "Searchable A", body: "body a", slug: "a" })
    const b = createPrompt({ title: "Searchable B", body: "body b", slug: "b" })
    setLabel(a.id, "env", "prod")
    const results = searchPrompts("Searchable", { labels: [{ key: "env", value: "prod" }] })
    expect(results.map((r) => r.prompt.id)).toEqual([a.id])
    expect(results.length).toBe(1)
    const none = searchPrompts("Searchable", { labels: [{ key: "env", value: "staging" }] })
    expect(none).toHaveLength(0)
    // b has no labels — must not leak in
    expect(none.map((r) => r.prompt.id)).not.toContain(b.id)
  })
})

describe("label idempotency through prompt lifecycle", () => {
  test("getPrompt unchanged by labels", () => {
    const p = createPrompt({ title: "Labeled", body: "body" })
    setLabel(p.id, "env", "prod")
    const fetched = getPrompt(p.id)
    expect(fetched?.id).toBe(p.id)
  })
})
