import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase, getDatabase } from "./database.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

import { createPrompt } from "./prompts.js"
import { createSchedule, listSchedules, getSchedule, deleteSchedule, getDueSchedules } from "./schedules.js"
import { getNextRunTime, validateCron } from "../lib/cron.js"

beforeEach(() => {
  closeDatabase()
  resetDatabase()
})

describe("cron parser", () => {
  test("validates valid cron expressions", () => {
    expect(validateCron("* * * * *")).toBeNull()
    expect(validateCron("*/5 * * * *")).toBeNull()
    expect(validateCron("0 * * * *")).toBeNull()
    expect(validateCron("0 0 * * *")).toBeNull()
    expect(validateCron("0 0 * * 1")).toBeNull()
  })

  test("rejects invalid cron expressions", () => {
    expect(validateCron("not a cron")).not.toBeNull()
    expect(validateCron("* * *")).not.toBeNull()
  })

  test("getNextRunTime returns future date", () => {
    const next = getNextRunTime("* * * * *", new Date())
    expect(next.getTime()).toBeGreaterThan(Date.now())
  })

  test("*/5 fires on 5-minute boundaries", () => {
    const from = new Date("2025-01-01T10:03:00Z")
    const next = getNextRunTime("*/5 * * * *", from)
    expect(next.getMinutes() % 5).toBe(0)
    expect(next.getTime()).toBeGreaterThan(from.getTime())
  })

  test("hourly cron fires at next top of hour", () => {
    const from = new Date("2025-01-01T10:30:00Z")
    const next = getNextRunTime("0 * * * *", from)
    expect(next.getMinutes()).toBe(0)
    expect(next.getHours()).toBe(11)
  })
})

describe("schedules", () => {
  function makePrompt() {
    return createPrompt({ title: "Test Prompt", body: "Hello {{name|world}}" })
  }

  test("creates a schedule", () => {
    const p = makePrompt()
    const s = createSchedule({ prompt_id: p.id, prompt_slug: p.slug, cron: "* * * * *" })
    expect(s.id).toMatch(/^SCH-/)
    expect(s.prompt_id).toBe(p.id)
    expect(s.run_count).toBe(0)
    expect(s.next_run_at).toBeTruthy()
    expect(new Date(s.next_run_at).getTime()).toBeGreaterThan(Date.now())
  })

  test("lists schedules", () => {
    const p = makePrompt()
    createSchedule({ prompt_id: p.id, prompt_slug: p.slug, cron: "* * * * *" })
    createSchedule({ prompt_id: p.id, prompt_slug: p.slug, cron: "0 * * * *" })
    const all = listSchedules()
    expect(all.length).toBe(2)
  })

  test("filters by prompt_id", () => {
    const p1 = makePrompt()
    const p2 = createPrompt({ title: "Other", body: "body" })
    createSchedule({ prompt_id: p1.id, prompt_slug: p1.slug, cron: "* * * * *" })
    createSchedule({ prompt_id: p2.id, prompt_slug: p2.slug, cron: "* * * * *" })
    expect(listSchedules(p1.id).length).toBe(1)
    expect(listSchedules(p2.id).length).toBe(1)
  })

  test("deletes a schedule", () => {
    const p = makePrompt()
    const s = createSchedule({ prompt_id: p.id, prompt_slug: p.slug, cron: "* * * * *" })
    deleteSchedule(s.id)
    expect(getSchedule(s.id)).toBeNull()
  })

  test("getDueSchedules returns nothing when no due schedules", () => {
    const p = makePrompt()
    createSchedule({ prompt_id: p.id, prompt_slug: p.slug, cron: "* * * * *" })
    // next_run_at is in the future, nothing due
    const due = getDueSchedules()
    expect(due.length).toBe(0)
  })

  test("stores and retrieves vars", () => {
    const p = makePrompt()
    const s = createSchedule({ prompt_id: p.id, prompt_slug: p.slug, cron: "* * * * *", vars: { name: "Alice" } })
    const retrieved = getSchedule(s.id)
    expect(retrieved?.vars?.name).toBe("Alice")
  })

  test("dry-run returns due schedules without mutating run state", () => {
    const db = getDatabase()
    const p = createPrompt({ title: "Due", body: "Hello {{name|world}}" })
    const s = createSchedule({ prompt_id: p.id, prompt_slug: p.slug, cron: "* * * * *" })
    db.run("UPDATE prompt_schedules SET next_run_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [s.id])

    const before = getSchedule(s.id)!
    const due = getDueSchedules({ dryRun: true })

    expect(due).toHaveLength(1)
    expect(due[0]?.rendered).toBe("Hello world")

    const after = getSchedule(s.id)!
    expect(after.run_count).toBe(before.run_count)
    expect(after.next_run_at).toBe(before.next_run_at)
    expect(after.last_run_at).toBe(before.last_run_at)
  })

  test("non-dry-run advances run state", () => {
    const db = getDatabase()
    const p = createPrompt({ title: "Due", body: "Hello {{name|world}}" })
    const s = createSchedule({ prompt_id: p.id, prompt_slug: p.slug, cron: "* * * * *" })
    db.run("UPDATE prompt_schedules SET next_run_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [s.id])

    const before = getSchedule(s.id)!
    getDueSchedules()

    const after = getSchedule(s.id)!
    expect(after.run_count).toBe(before.run_count + 1)
    expect(after.last_run_at).not.toBeNull()
    expect(new Date(after.next_run_at).getTime()).toBeGreaterThan(Date.now())
  })

  test("dry-run default is mutation (backward compatible)", () => {
    const db = getDatabase()
    const p = createPrompt({ title: "Due", body: "Hello {{name|world}}" })
    const s = createSchedule({ prompt_id: p.id, prompt_slug: p.slug, cron: "* * * * *" })
    db.run("UPDATE prompt_schedules SET next_run_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [s.id])
    getDueSchedules()
    expect(getSchedule(s.id)!.run_count).toBe(1)
  })

  test("renders through the canonical engine (escaped braces stay literal)", () => {
    const db = getDatabase()
    const p = createPrompt({ title: "Escaped", body: "\\{{name}} literal {{name|d}}" })
    const s = createSchedule({ prompt_id: p.id, prompt_slug: p.slug, cron: "* * * * *" })
    db.run("UPDATE prompt_schedules SET next_run_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [s.id])
    const due = getDueSchedules({ dryRun: true })
    expect(due[0]?.rendered).toBe("{{name}} literal d")
  })

  test("typed schedule vars render through the canonical engine", () => {
    const db = getDatabase()
    const p = createPrompt({ title: "Typed", body: "Count {{count}}" })
    const s = createSchedule({
      prompt_id: p.id,
      prompt_slug: p.slug,
      cron: "* * * * *",
      vars: { count: "42" },
    })
    db.run("UPDATE prompt_schedules SET next_run_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [s.id])
    const due = getDueSchedules({ dryRun: true })
    expect(due[0]?.rendered).toBe("Count 42")
  })
})
