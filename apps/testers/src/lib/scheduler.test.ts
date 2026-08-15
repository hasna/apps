process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect } from "bun:test";
import { parseCronField, parseCron, shouldRunAt, getNextRunTime } from "./scheduler.js";

describe("parseCronField", () => {
  test("* returns all values", () => {
    expect(parseCronField("*", 0, 5)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("exact value", () => {
    expect(parseCronField("3", 0, 59)).toEqual([3]);
  });

  test("range", () => {
    expect(parseCronField("1-4", 0, 10)).toEqual([1, 2, 3, 4]);
  });

  test("step */N", () => {
    expect(parseCronField("*/15", 0, 59)).toEqual([0, 15, 30, 45]);
  });

  test("range with step", () => {
    expect(parseCronField("1-10/3", 0, 59)).toEqual([1, 4, 7, 10]);
  });

  test("list", () => {
    expect(parseCronField("1,3,5", 0, 10)).toEqual([1, 3, 5]);
  });

  test("mixed list with range", () => {
    expect(parseCronField("1,3-5,9", 0, 10)).toEqual([1, 3, 4, 5, 9]);
  });

  test("out of range values clamped", () => {
    expect(parseCronField("100", 0, 59)).toEqual([]);
  });

  test("throws on invalid step", () => {
    expect(() => parseCronField("*/0", 0, 59)).toThrow();
  });
});

describe("parseCron", () => {
  test("parses every minute", () => {
    const cron = parseCron("* * * * *");
    expect(cron.minutes.length).toBe(60);
    expect(cron.hours.length).toBe(24);
  });

  test("parses specific time", () => {
    const cron = parseCron("30 9 * * *");
    expect(cron.minutes).toEqual([30]);
    expect(cron.hours).toEqual([9]);
  });

  test("parses weekdays", () => {
    const cron = parseCron("0 9 * * 1-5");
    expect(cron.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  test("parses every 5 minutes", () => {
    const cron = parseCron("*/5 * * * *");
    expect(cron.minutes).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  });

  test("throws on invalid expression", () => {
    expect(() => parseCron("* * *")).toThrow();
    expect(() => parseCron("* * * * * *")).toThrow();
  });
});

describe("shouldRunAt", () => {
  test("every minute matches any time", () => {
    expect(shouldRunAt("* * * * *", new Date("2026-03-12T10:30:00"))).toBe(true);
  });

  test("specific minute matches", () => {
    expect(shouldRunAt("30 * * * *", new Date("2026-03-12T10:30:00"))).toBe(true);
    expect(shouldRunAt("30 * * * *", new Date("2026-03-12T10:31:00"))).toBe(false);
  });

  test("specific hour and minute", () => {
    expect(shouldRunAt("0 9 * * *", new Date("2026-03-12T09:00:00"))).toBe(true);
    expect(shouldRunAt("0 9 * * *", new Date("2026-03-12T10:00:00"))).toBe(false);
  });

  test("day of week", () => {
    // March 12, 2026 is a Thursday (day 4)
    expect(shouldRunAt("0 9 * * 4", new Date("2026-03-12T09:00:00"))).toBe(true);
    expect(shouldRunAt("0 9 * * 1", new Date("2026-03-12T09:00:00"))).toBe(false);
  });

  test("every 5 minutes", () => {
    expect(shouldRunAt("*/5 * * * *", new Date("2026-03-12T10:00:00"))).toBe(true);
    expect(shouldRunAt("*/5 * * * *", new Date("2026-03-12T10:05:00"))).toBe(true);
    expect(shouldRunAt("*/5 * * * *", new Date("2026-03-12T10:03:00"))).toBe(false);
  });
});

describe("getNextRunTime", () => {
  test("every minute returns next minute", () => {
    const now = new Date("2026-03-12T10:30:00");
    const next = getNextRunTime("* * * * *", now);
    expect(next.getTime()).toBe(new Date("2026-03-12T10:31:00").getTime());
  });

  test("specific time finds correct next", () => {
    const now = new Date("2026-03-12T08:00:00");
    const next = getNextRunTime("0 9 * * *", now);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  test("past time rolls to next day", () => {
    const now = new Date("2026-03-12T10:00:00");
    const next = getNextRunTime("0 9 * * *", now);
    expect(next.getDate()).toBe(13);
    expect(next.getHours()).toBe(9);
  });

  test("every 5 minutes finds next", () => {
    const now = new Date("2026-03-12T10:03:00");
    const next = getNextRunTime("*/5 * * * *", now);
    expect(next.getMinutes()).toBe(5);
  });
});
