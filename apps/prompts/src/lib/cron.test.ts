import { describe, expect, test } from "bun:test"
import { getNextRunTime, validateCron } from "./cron.js"

describe("validateCron", () => {
  test("accepts valid 5-field expressions", () => {
    expect(validateCron("* * * * *")).toBeNull()
    expect(validateCron("0 9 * * *")).toBeNull()
    expect(validateCron("*/5 * * * *")).toBeNull()
    expect(validateCron("0 0 1 * *")).toBeNull()
    expect(validateCron("30 14 * * 1-5")).toBeNull()
  })

  test("rejects invalid expressions", () => {
    expect(validateCron("* * * *")).not.toBeNull()
    expect(validateCron("invalid")).not.toBeNull()
    expect(validateCron("")).not.toBeNull()
  })
})

describe("getNextRunTime", () => {
  test("throws on invalid cron", () => {
    expect(() => getNextRunTime("* * * *", new Date())).toThrow()
  })

  test("every minute returns next minute", () => {
    const from = new Date("2024-01-15T10:00:00Z")
    const next = getNextRunTime("* * * * *", from)
    expect(next.getMinutes()).toBe(1)
    expect(next.getHours()).toBe(10)
  })

  test("hourly at :30 returns correct time", () => {
    const from = new Date("2024-01-15T10:00:00Z")
    const next = getNextRunTime("30 * * * *", from)
    expect(next.getMinutes()).toBe(30)
  })

  test("daily at 9am returns correct hour", () => {
    const from = new Date("2024-01-15T08:00:00Z")
    const next = getNextRunTime("0 9 * * *", from)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
  })

  test("advances past midnight when no valid time today", () => {
    const from = new Date("2024-01-15T23:30:00Z")
    const next = getNextRunTime("0 9 * * *", from)
    // Next 9am must be after the from time
    expect(next > from).toBe(true)
    expect(next.getHours()).toBe(9)
  })

  test("step expressions work", () => {
    const from = new Date("2024-01-15T10:00:00Z")
    const next = getNextRunTime("*/15 * * * *", from)
    expect(next.getMinutes() % 15).toBe(0)
  })

  test("range expressions work", () => {
    const from = new Date("2024-01-15T10:00:00Z")
    const next = getNextRunTime("0 9-17 * * *", from)
    expect(next.getHours()).toBeGreaterThanOrEqual(9)
    expect(next.getHours()).toBeLessThanOrEqual(17)
  })

  test("specific day of week", () => {
    // 0=Sun: next Sunday from a Monday
    const from = new Date("2024-01-15T10:00:00Z") // Monday
    const next = getNextRunTime("0 0 * * 0", from)
    expect(next.getDay()).toBe(0)
  })

  test("comma-separated values", () => {
    const from = new Date("2024-01-15T10:00:00Z")
    const next = getNextRunTime("0 9,18 * * *", from)
    expect([9, 18]).toContain(next.getHours())
  })
})
