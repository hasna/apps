// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { describe, expect, test } from "bun:test";
import {
  pushToLogs,
  registerWithSessions,
  runPostSessionIntegrations,
  saveToRecordings,
} from "../src/lib/integrations.js";
import type { Session } from "../src/types/index.js";

function makeSession(): Session {
  return {
    id: "integ-test-session",
    task: "Open Safari and search for the weather in Cluj",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    status: "completed",
    steps: 3,
    total_tokens_in: 100,
    total_tokens_out: 50,
    total_duration_ms: 1200,
    tags: ["test"],
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:20Z",
  };
}

describe("integrations — no-op contract when sibling packages are absent", () => {
  test("saveToRecordings returns false when @hasna/recordings is not installed", async () => {
    expect(await saveToRecordings(makeSession(), [])).toBe(false);
  });

  test("registerWithSessions returns false when @hasna/sessions is not installed", async () => {
    expect(await registerWithSessions(makeSession())).toBe(false);
  });

  test("pushToLogs returns false when @hasna/logs is not installed", async () => {
    expect(await pushToLogs(makeSession(), [])).toBe(false);
  });

  test("runPostSessionIntegrations reports all lanes false and never throws", async () => {
    const result = await runPostSessionIntegrations(makeSession(), [
      {
        id: 1,
        session_id: "integ-test-session",
        step: 0,
        action: { type: "click", point: { x: 1, y: 2 } },
        reasoning: "click",
        success: true,
        duration_ms: 10,
        created_at: "2026-01-01T00:00:01Z",
      },
    ]);
    expect(result).toEqual({ recordings: false, sessions: false, logs: false });
  });

  test("saveToRecordings handles a session whose task exceeds 100 chars without throwing", async () => {
    const long = makeSession();
    long.task = "x".repeat(500);
    expect(await saveToRecordings(long, [])).toBe(false);
  });
});
