import { describe, expect, test, beforeEach } from "bun:test"
import { closeDatabase, resetDatabase } from "./database.js"

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
})
