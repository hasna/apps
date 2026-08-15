import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase } from "../db/database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { runAudit } from "./audit.js"
import { createPrompt, setExpiry } from "../db/prompts.js"
import { getDatabase } from "../db/database.js"
import { ensureCollection } from "../db/collections.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("runAudit", () => {
  test("returns clean report for empty db", () => {
    const report = runAudit()
    expect(report.issues).toHaveLength(0)
    expect(report.errors).toBe(0)
    expect(report.warnings).toBe(0)
    expect(report.info).toBe(0)
    expect(report.checked_at).toBeTruthy()
  })

  test("detects prompts with missing version history", () => {
    // Insert prompt directly bypassing createPrompt so no version entry is added
    const db = getDatabase()
    db.exec(`INSERT INTO prompts (id, name, slug, title, body, collection, tags, variables) VALUES ('prmt-novers1', 'no-history', 'no-history', 'No History', 'test body content', 'default', '[]', '[]')`)
    const report = runAudit()
    const issues = report.issues.filter((i) => i.type === "missing-version-history")
    expect(issues.length).toBeGreaterThan(0)
    expect(report.warnings).toBeGreaterThan(0)
  })

  test("detects empty non-default collections", () => {
    ensureCollection("empty-col")
    const report = runAudit()
    const issues = report.issues.filter((i) => i.type === "empty-collection")
    expect(issues.length).toBeGreaterThan(0)
    expect(report.info).toBeGreaterThan(0)
  })

  test("detects near-duplicate slugs", () => {
    createPrompt({ title: "My Prompt", body: "body content here" })
    createPrompt({ title: "My Prompt 2", body: "body content here", slug: "my-prompt-2" })
    const report = runAudit()
    const issues = report.issues.filter((i) => i.type === "near-duplicate-slug")
    expect(issues.length).toBeGreaterThan(0)
  })

  test("detects expired prompts", () => {
    const p = createPrompt({ title: "Old Prompt", body: "body content here" })
    setExpiry(p.id, "2020-01-01T00:00:00Z")
    const report = runAudit()
    const issues = report.issues.filter((i) => i.type === "expired")
    expect(issues.length).toBeGreaterThan(0)
  })

  test("counts errors/warnings/info correctly", () => {
    const report = runAudit()
    const totalComputed = report.errors + report.warnings + report.info
    expect(totalComputed).toBe(report.issues.length)
  })
})
