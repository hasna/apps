import { describe, expect, test } from "bun:test";
import type { Loop } from "../types.js";
import { classifyLoopExecutionStaleness } from "./execution-staleness.js";

/**
 * BUG 96c837b0 regression tests: a machine-pinned loop created on the hosted
 * control plane stays active and due forever with zero runs when no
 * `loops-runner` serves its machine, and no surface says so.
 *
 * The classifier must flag exactly that state, and must stay silent on every
 * legitimate one: a loop that was claimed at least once (a run row exists),
 * a loop not yet due, a loop inside the first-slot grace window, and an
 * inactive/archived loop.
 */
const T0 = Date.parse("2026-08-19T12:25:55.000Z");

function loopFixture(overrides: Partial<Loop> = {}): Loop {
  return {
    id: "01a019fc3946f09e99dbee23b9ab5669",
    name: "pinned",
    status: "active",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command: "/bin/true" },
    machine: { id: "station02", route: "local", local: true, confidence: "exact" },
    catchUp: "latest",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 0,
    leaseMs: 30_000,
    nextRunAt: new Date(T0 + 60_000).toISOString(),
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

describe("classifyLoopExecutionStaleness", () => {
  test("machine-pinned loop, due, zero runs, past grace -> unserved (live artifact shape)", () => {
    const status = classifyLoopExecutionStaleness(loopFixture(), {
      now: new Date(T0 + 20 * 60_000),
      hasRuns: false,
    });
    expect(status.state).toBe("unserved");
    expect(status.reason).toContain("station02");
  });

  test("machine-less loop, due, zero runs, past grace -> unserved, reason names no machine", () => {
    const { machine: _machine, ...rest } = loopFixture();
    const status = classifyLoopExecutionStaleness(rest as Loop, {
      now: new Date(T0 + 20 * 60_000),
      hasRuns: false,
    });
    expect(status.state).toBe("unserved");
    expect(status.reason).not.toContain("station02");
  });

  test("inside the first-slot grace window -> ok", () => {
    const status = classifyLoopExecutionStaleness(loopFixture(), {
      now: new Date(T0 + 5 * 60_000),
      hasRuns: false,
    });
    expect(status.state).toBe("ok");
    expect(status.reason).toBeUndefined();
  });

  test("at exactly the grace boundary -> unserved", () => {
    const status = classifyLoopExecutionStaleness(loopFixture(), {
      now: new Date(T0 + 10 * 60_000),
      hasRuns: false,
    });
    expect(status.state).toBe("unserved");
  });

  test("a loop claimed at least once (a run row exists) -> ok", () => {
    const status = classifyLoopExecutionStaleness(loopFixture(), {
      now: new Date(T0 + 20 * 60_000),
      hasRuns: true,
    });
    expect(status.state).toBe("ok");
  });

  test("not yet due -> ok even with zero runs", () => {
    const status = classifyLoopExecutionStaleness(
      loopFixture({ nextRunAt: new Date(T0 + 24 * 60 * 60_000).toISOString() }),
      { now: new Date(T0 + 20 * 60_000), hasRuns: false },
    );
    expect(status.state).toBe("ok");
  });

  test("no nextRunAt -> ok", () => {
    const status = classifyLoopExecutionStaleness(loopFixture({ nextRunAt: undefined }), {
      now: new Date(T0 + 20 * 60_000),
      hasRuns: false,
    });
    expect(status.state).toBe("ok");
  });

  test("inactive or archived loops -> ok", () => {
    for (const statusValue of ["paused", "stopped", "expired"] as const) {
      expect(
        classifyLoopExecutionStaleness(loopFixture({ status: statusValue }), {
          now: new Date(T0 + 20 * 60_000),
          hasRuns: false,
        }).state,
      ).toBe("ok");
    }
    expect(
      classifyLoopExecutionStaleness(
        loopFixture({ status: "active", archivedAt: new Date(T0 + 60_000).toISOString() }),
        { now: new Date(T0 + 20 * 60_000), hasRuns: false },
      ).state,
    ).toBe("ok");
  });

  test("graceMs override is honored", () => {
    expect(
      classifyLoopExecutionStaleness(loopFixture(), {
        now: new Date(T0 + 3 * 60_000),
        hasRuns: false,
        graceMs: 2 * 60_000,
      }).state,
    ).toBe("unserved");
  });
});
