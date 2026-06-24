import { describe, expect, test } from "bun:test";
import {
  renderSessionDetail,
  renderSessionList,
  truncateText,
} from "./output.js";
import type { ActionLog, Session } from "../types/index.js";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-abcdef1234567890",
    task: "Inspect a long browser workflow and produce a report with enough detail that it would previously fill a terminal window.",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    status: "completed",
    steps: 12,
    total_tokens_in: 12_000,
    total_tokens_out: 3_000,
    total_duration_ms: 18_500,
    tags: ["audit"],
    created_at: "2026-06-24T06:00:00.000Z",
    completed_at: "2026-06-24T06:01:00.000Z",
    ...overrides,
  };
}

function actionLog(step: number, reasoning = "reasoning ".repeat(40)): ActionLog {
  return {
    id: step + 1,
    session_id: "session-abcdef1234567890",
    step,
    action: { type: "type", text: "secret text that should be summarized by length" },
    reasoning,
    success: true,
    duration_ms: 250,
    tokens_in: 100,
    tokens_out: 20,
    created_at: "2026-06-24T06:00:10.000Z",
  };
}

describe("compact CLI output helpers", () => {
  test("truncateText normalizes whitespace and caps long text", () => {
    expect(truncateText("alpha\n\nbeta   gamma", 20)).toBe("alpha beta gamma");
    expect(truncateText("x".repeat(40), 12)).toBe("xxxxxxxxx...");
  });

  test("renderSessionList emits compact rows and discovery hints", () => {
    const output = renderSessionList([session()], {
      limit: 10,
      cursor: 0,
      hasMore: true,
      nextCursor: 10,
    });

    expect(output).toContain("id       status");
    expect(output).toContain("session-");
    expect(output).toContain("More available");
    expect(output).toContain("computer session <id> --verbose");
    expect(output.length).toBeLessThan(700);
  });

  test("renderSessionDetail caps logs by default and exposes verbose disclosure", () => {
    const logs = Array.from({ length: 12 }, (_, index) => actionLog(index));
    const compact = renderSessionDetail(session(), logs, { limit: 3, cursor: 0 });
    const verbose = renderSessionDetail(session(), logs, { verbose: true });

    expect(compact).toContain("Action log (3/12");
    expect(compact).toContain("More logs available");
    expect(compact).not.toContain("[  4]");
    expect(verbose).toContain("Action log (12/12, verbose)");
    expect(verbose).toContain("[ 12]");
  });
});
