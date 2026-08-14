import { describe, expect, test } from "bun:test"
import { diffTexts, formatDiff } from "./diff.js"

describe("diffTexts", () => {
  test("identical texts produce all unchanged lines", () => {
    const lines = diffTexts("hello\nworld", "hello\nworld")
    expect(lines.every((l) => l.type === "unchanged")).toBe(true)
    expect(lines).toHaveLength(2)
  })

  test("added line is detected", () => {
    const lines = diffTexts("hello", "hello\nworld")
    const added = lines.filter((l) => l.type === "added")
    expect(added).toHaveLength(1)
    expect(added[0]!.content).toBe("world")
  })

  test("removed line is detected", () => {
    const lines = diffTexts("hello\nworld", "hello")
    const removed = lines.filter((l) => l.type === "removed")
    expect(removed).toHaveLength(1)
    expect(removed[0]!.content).toBe("world")
  })

  test("completely different texts", () => {
    const lines = diffTexts("aaa", "bbb")
    const removed = lines.filter((l) => l.type === "removed")
    const added = lines.filter((l) => l.type === "added")
    expect(removed).toHaveLength(1)
    expect(added).toHaveLength(1)
  })

  test("empty strings", () => {
    const lines = diffTexts("", "")
    expect(lines).toHaveLength(1)
  })

  test("empty to non-empty", () => {
    const lines = diffTexts("", "new line")
    const added = lines.filter((l) => l.type === "added")
    expect(added.length).toBeGreaterThanOrEqual(1)
  })

  test("multi-line change", () => {
    const a = "line1\nline2\nline3"
    const b = "line1\nchanged\nline3"
    const lines = diffTexts(a, b)
    const removed = lines.filter((l) => l.type === "removed")
    const added = lines.filter((l) => l.type === "added")
    expect(removed.some((l) => l.content === "line2")).toBe(true)
    expect(added.some((l) => l.content === "changed")).toBe(true)
  })
})

describe("formatDiff", () => {
  test("prefixes added lines with +", () => {
    const lines = diffTexts("hello", "hello\nworld")
    const formatted = formatDiff(lines)
    expect(formatted).toContain("+ world")
  })

  test("prefixes removed lines with -", () => {
    const lines = diffTexts("hello\nworld", "hello")
    const formatted = formatDiff(lines)
    expect(formatted).toContain("- world")
  })

  test("prefixes unchanged lines with spaces", () => {
    const lines = diffTexts("hello", "hello")
    const formatted = formatDiff(lines)
    expect(formatted).toContain("  hello")
  })
})
