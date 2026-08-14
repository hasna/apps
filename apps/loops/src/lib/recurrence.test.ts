import { describe, expect, test } from "bun:test";
import type { Loop } from "../types.js";
import { dueSlots, initialNextRun, MAX_CATCH_UP_SLOTS, nextCronRun, parseCron, parseDuration } from "./recurrence.js";

function cronLoop(patch: Partial<Loop> & { schedule: Loop["schedule"] }): Loop {
  return {
    id: "loop1",
    name: "cron-loop",
    status: "active",
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
    ...patch,
  };
}

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

  test("memoizes parsed cron expressions", () => {
    expect(parseCron("*/5 * * * *")).toBe(parseCron("*/5 * * * *"));
  });

  test("computes latest cron slot across a year-long gap without walking every minute", () => {
    const loop = cronLoop({
      schedule: { type: "cron", expression: "*/15 * * * *" },
      nextRunAt: "2025-01-01T00:00:00.000Z",
    });
    const started = performance.now();
    const plan = dueSlots(loop, new Date("2026-01-01T00:17:45Z"));
    const elapsedMs = performance.now() - started;
    expect(plan.slots).toEqual(["2026-01-01T00:15:00.000Z"]);
    expect(elapsedMs).toBeLessThan(250);
  });

  test("computes latest slot for dom-restricted crons via the bounded backward scan", () => {
    const loop = cronLoop({
      schedule: { type: "cron", expression: "*/15 * 1-31 * *" },
      nextRunAt: "2025-06-01T00:00:00.000Z",
    });
    expect(dueSlots(loop, new Date("2026-01-01T00:47:00Z")).slots).toEqual(["2026-01-01T00:45:00.000Z"]);
  });

  test("latest slot for sparse restricted crons stays on the cron grid", () => {
    const expression = "30 6 1 * *";
    const now = new Date("2026-03-20T12:00:00Z");
    const first = nextCronRun(expression, new Date("2025-03-20T12:00:00Z"));
    const loop = cronLoop({
      schedule: { type: "cron", expression },
      nextRunAt: first.toISOString(),
    });
    const [slot] = dueSlots(loop, now).slots;
    expect(slot).toBeDefined();
    expect(new Date(slot!).getTime()).toBeLessThanOrEqual(now.getTime());
    expect(new Date(slot!).getTime()).toBeGreaterThanOrEqual(first.getTime());
    expect(nextCronRun(expression, new Date(slot!)).getTime()).toBeGreaterThan(now.getTime());
  });

  test("caps catch-up all plans regardless of catchUpLimit", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const loop = cronLoop({
      schedule: { type: "interval", everyMs: 60_000 },
      catchUp: "all",
      catchUpLimit: 100_000,
      nextRunAt: new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const plan = dueSlots(loop, now);
    expect(plan.slots).toHaveLength(MAX_CATCH_UP_SLOTS);
    expect(plan.slots[0]).toBe(loop.nextRunAt!);
  });
});
