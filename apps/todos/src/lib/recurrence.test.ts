import { describe, it, expect } from "bun:test";
import { parseRecurrenceRule, isValidRecurrenceRule, nextOccurrence } from "./recurrence.js";

describe("parseRecurrenceRule", () => {
  it("parses 'every day'", () => {
    const result = parseRecurrenceRule("every day");
    expect(result).toEqual({ type: "interval", interval: 1, unit: "day" });
  });

  it("parses 'daily'", () => {
    const result = parseRecurrenceRule("daily");
    expect(result).toEqual({ type: "interval", interval: 1, unit: "day" });
  });

  it("parses 'every week'", () => {
    const result = parseRecurrenceRule("every week");
    expect(result).toEqual({ type: "interval", interval: 1, unit: "week" });
  });

  it("parses 'weekly'", () => {
    const result = parseRecurrenceRule("weekly");
    expect(result).toEqual({ type: "interval", interval: 1, unit: "week" });
  });

  it("parses 'every month'", () => {
    const result = parseRecurrenceRule("every month");
    expect(result).toEqual({ type: "interval", interval: 1, unit: "month" });
  });

  it("parses 'monthly'", () => {
    const result = parseRecurrenceRule("monthly");
    expect(result).toEqual({ type: "interval", interval: 1, unit: "month" });
  });

  it("parses 'every 2 weeks'", () => {
    const result = parseRecurrenceRule("every 2 weeks");
    expect(result).toEqual({ type: "interval", interval: 2, unit: "week" });
  });

  it("parses 'every 3 days'", () => {
    const result = parseRecurrenceRule("every 3 days");
    expect(result).toEqual({ type: "interval", interval: 3, unit: "day" });
  });

  it("parses 'every 6 months'", () => {
    const result = parseRecurrenceRule("every 6 months");
    expect(result).toEqual({ type: "interval", interval: 6, unit: "month" });
  });

  it("parses 'every weekday'", () => {
    const result = parseRecurrenceRule("every weekday");
    expect(result).toEqual({ type: "specific_days", days: [1, 2, 3, 4, 5] });
  });

  it("parses 'every monday'", () => {
    const result = parseRecurrenceRule("every monday");
    expect(result).toEqual({ type: "specific_days", days: [1] });
  });

  it("parses 'every mon,wed,fri'", () => {
    const result = parseRecurrenceRule("every mon,wed,fri");
    expect(result).toEqual({ type: "specific_days", days: [1, 3, 5] });
  });

  it("parses 'every tuesday,thursday'", () => {
    const result = parseRecurrenceRule("every tuesday,thursday");
    expect(result).toEqual({ type: "specific_days", days: [2, 4] });
  });

  it("is case-insensitive", () => {
    const result = parseRecurrenceRule("Every Monday");
    expect(result).toEqual({ type: "specific_days", days: [1] });
  });

  it("trims whitespace", () => {
    const result = parseRecurrenceRule("  every day  ");
    expect(result).toEqual({ type: "interval", interval: 1, unit: "day" });
  });

  it("throws on invalid rule", () => {
    expect(() => parseRecurrenceRule("not a rule")).toThrow("Invalid recurrence rule");
  });

  it("throws on empty string", () => {
    expect(() => parseRecurrenceRule("")).toThrow("Invalid recurrence rule");
  });
});

describe("isValidRecurrenceRule", () => {
  it("returns true for valid rules", () => {
    expect(isValidRecurrenceRule("every day")).toBe(true);
    expect(isValidRecurrenceRule("every 2 weeks")).toBe(true);
    expect(isValidRecurrenceRule("every mon,fri")).toBe(true);
  });

  it("returns false for invalid rules", () => {
    expect(isValidRecurrenceRule("nope")).toBe(false);
    expect(isValidRecurrenceRule("")).toBe(false);
  });
});

describe("nextOccurrence", () => {
  it("calculates next day", () => {
    const from = new Date("2026-03-13T10:00:00Z");
    const next = nextOccurrence("every day", from);
    expect(next).toContain("2026-03-14");
  });

  it("calculates next week", () => {
    const from = new Date("2026-03-13T10:00:00Z");
    const next = nextOccurrence("every week", from);
    expect(next).toContain("2026-03-20");
  });

  it("calculates every 2 weeks", () => {
    const from = new Date("2026-03-13T10:00:00Z");
    const next = nextOccurrence("every 2 weeks", from);
    expect(next).toContain("2026-03-27");
  });

  it("calculates next month", () => {
    const from = new Date("2026-03-13T10:00:00Z");
    const next = nextOccurrence("every month", from);
    expect(next).toContain("2026-04-13");
  });

  it("calculates next specific day (monday from friday)", () => {
    const friday = new Date("2026-03-13T10:00:00Z"); // March 13, 2026 is a Friday
    const next = nextOccurrence("every monday", friday);
    expect(next).toContain("2026-03-16"); // Next Monday
  });

  it("calculates next weekday from friday (should be monday)", () => {
    const friday = new Date("2026-03-13T10:00:00Z");
    const next = nextOccurrence("every weekday", friday);
    expect(next).toContain("2026-03-16"); // Monday
  });

  it("calculates next specific day from same day (wraps to next week)", () => {
    const monday = new Date("2026-03-16T10:00:00Z");
    const next = nextOccurrence("every monday", monday);
    expect(next).toContain("2026-03-23"); // Next Monday
  });

  it("returns ISO string", () => {
    const result = nextOccurrence("every day", new Date("2026-03-13T10:00:00Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
