import { describe, test, expect } from "bun:test";
import { createPollHealth, describeError } from "./poll-health";

/**
 * Deterministic tests for the failure-reporting logic (todos d3c6b65e).
 *
 * The clock and the sink are both injected, so these assert the reporting
 * CONTRACT without waiting on a real transport. The companion test in
 * poll.test.ts proves the contract actually holds against a real failing
 * store; neither replaces the other.
 */
describe("createPollHealth", () => {
  const collect = () => {
    const lines: string[] = [];
    return { lines, report: (line: string) => { lines.push(line); } };
  };

  test("reports the very first failure — one blip is still visible", () => {
    const { lines, report } = collect();
    const health = createPollHealth({ label: "watch", report, degradedAfter: 3 });

    health.recordFailure(new Error("BOOM_ONE"));

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("BOOM_ONE");
    expect(health.consecutiveFailures).toBe(1);
    expect(health.degraded).toBe(false);
  });

  test("labels DEGRADED once the threshold is reached", () => {
    const { lines, report } = collect();
    const health = createPollHealth({ label: "watch", report, degradedAfter: 3 });

    health.recordFailure(new Error("BOOM"));
    health.recordFailure(new Error("BOOM"));
    expect(lines.some((l) => l.includes("DEGRADED"))).toBe(false);

    health.recordFailure(new Error("BOOM"));
    expect(lines.some((l) => l.includes("DEGRADED"))).toBe(true);
    expect(health.degraded).toBe(true);
  });

  test("keeps saying DEGRADED while the outage persists, but throttled", () => {
    const { lines, report } = collect();
    let clock = 0;
    const health = createPollHealth({
      label: "watch", report, degradedAfter: 2, repeatEveryMs: 1000, now: () => clock,
    });

    health.recordFailure(new Error("BOOM"));
    health.recordFailure(new Error("BOOM")); // transition -> DEGRADED
    const afterTransition = lines.filter((l) => l.includes("DEGRADED")).length;
    expect(afterTransition).toBe(1);

    clock = 500;
    health.recordFailure(new Error("BOOM")); // inside the window -> suppressed
    expect(lines.filter((l) => l.includes("DEGRADED")).length).toBe(1);

    clock = 1600;
    health.recordFailure(new Error("BOOM")); // past the window -> repeats
    expect(lines.filter((l) => l.includes("DEGRADED")).length).toBe(2);
  });

  test("announces RECOVERED after a degraded run, and only then", () => {
    const { lines, report } = collect();
    const health = createPollHealth({ label: "watch", report, degradedAfter: 2 });

    health.recordFailure(new Error("BOOM"));
    health.recordSuccess(); // never degraded -> stays quiet
    expect(lines.some((l) => l.includes("RECOVERED"))).toBe(false);

    health.recordFailure(new Error("BOOM"));
    health.recordFailure(new Error("BOOM"));
    health.recordSuccess();
    expect(lines.some((l) => l.includes("RECOVERED"))).toBe(true);
    expect(health.consecutiveFailures).toBe(0);
    expect(health.degraded).toBe(false);
  });

  test("a throwing reporter cannot kill the poll loop", () => {
    const health = createPollHealth({
      label: "watch",
      report: () => { throw new Error("sink is broken"); },
    });
    expect(() => health.recordFailure(new Error("BOOM"))).not.toThrow();
  });
});

describe("describeError", () => {
  test("uses the message of an Error, and its cause when present", () => {
    expect(describeError(new Error("plain"))).toBe("plain");
    const wrapped = new Error("outer", { cause: new Error("inner") });
    expect(describeError(wrapped)).toContain("inner");
  });

  test("summarises an HTTP failure by method, path and status only", () => {
    const text = describeError({ method: "GET", path: "/v1/messages", status: 503 });
    expect(text).toBe("GET /v1/messages -> 503");
  });

  test("NEVER surfaces a response body or headers, which can carry a token", () => {
    // Credential hygiene: an HTTP failure object routinely carries the request
    // headers or a server echo. Only the three safe fields may be rendered.
    const text = describeError({
      method: "GET",
      path: "/v1/messages",
      status: 401,
      body: { token: "sk-should-never-appear" },
      headers: { authorization: "Bearer should-never-appear" },
    });
    expect(text).toBe("GET /v1/messages -> 401");
    expect(text).not.toContain("should-never-appear");
  });

  test("does not deep-stringify an arbitrary object", () => {
    const text = describeError({ secretish: "should-never-appear" });
    expect(text).not.toContain("should-never-appear");
  });
});
