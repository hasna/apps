import { describe, expect, test } from "bun:test";
import type { Loop } from "../types.js";
import { dueSlots, initialNextRun, nextCronRun, parseDuration } from "./schedule.js";

describe("schedule", () => {
  test("parses compact durations", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("2s")).toBe(2_000);
    expect(parseDuration("3m")).toBe(180_000);
    expect(parseDuration("1h")).toBe(3_600_000);
  });

  test("computes cron runs", () => {
    const next = nextCronRun("*/15 * * * *", new Date("2026-01-01T00:07:00Z"));
    expect(next.toISOString()).toBe("2026-01-01T00:15:00.000Z");
  });

  test("coalesces interval catch-up to latest slot", () => {
    const loop: Loop = {
      id: "loop1",
      name: "latest",
      status: "active",
      schedule: { type: "interval", everyMs: 60_000 },
      target: { type: "command", command: "true" },
      nextRunAt: "2026-01-01T00:00:00.000Z",
      catchUp: "latest",
      catchUpLimit: 50,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 60_000,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(dueSlots(loop, new Date("2026-01-01T00:04:30Z")).slots).toEqual(["2026-01-01T00:04:00.000Z"]);
  });

  test("initial dynamic schedule defaults to one minute", () => {
    expect(initialNextRun({ type: "dynamic" }, new Date("2026-01-01T00:00:00Z"))).toBe(
      "2026-01-01T00:01:00.000Z",
    );
  });
});
