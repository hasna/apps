import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDb,
  createSession,
  logAction,
  recordModelUsage,
} from "../src/db/index.js";
import {
  addObservation,
  addRunStep,
  createApproval,
  createWorkflowRun,
  recordArtifact,
  recordPolicyDecision,
} from "../src/agent/runtime.js";
import { buildSessionTimeline } from "../src/server/timeline.js";
import type { Session } from "../src/types/index.js";

let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): string {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-dashboard-timeline-"));
  const dbPath = join(tempDir, "computer.db");
  process.env.COMPUTER_DATA_DIR = tempDir;
  process.env.COMPUTER_DB_PATH = dbPath;
  return dbPath;
}

afterEach(() => {
  closeDb();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("dashboard timeline", () => {
  test("assembles ordered live run events from durable runtime and action logs", async () => {
    useTempDb();
    const session: Session = {
      id: "timeline-run-1",
      task: "Inspect visible browser session",
      provider: "anthropic",
      model: "claude-test",
      status: "waiting_on_approval",
      steps: 1,
      total_tokens_in: 12,
      total_tokens_out: 8,
      total_duration_ms: 420,
      tags: ["browser", "fleet"],
      created_at: new Date("2026-06-19T10:00:00.000Z").toISOString(),
    };
    await createSession(session);
    createWorkflowRun({ id: session.id, status: "running" });
    const step = addRunStep({
      runId: session.id,
      stepIndex: 0,
      action: { type: "click", point: { x: 128, y: 256 } },
      result: { success: true },
    });
    await logAction({
      session_id: session.id,
      step: 0,
      action: { type: "type", text: "do-not-render-this-secret" },
      reasoning: "enter the requested value",
      success: true,
      duration_ms: 30,
      tokens_in: 12,
      tokens_out: 8,
      screenshot_path: "/tmp/step-0.png",
    });
    createApproval({ runId: session.id, capability: "computer.type", reason: "typed text requires review" });
    recordPolicyDecision({
      runId: session.id,
      capability: "computer.type",
      decision: "requires_confirmation",
      reason: "text input is gated",
    });
    addObservation({
      runId: session.id,
      stepId: step.id,
      kind: "verifier_decision",
      data: { status: "needs_more_steps", confidence: 0.4, reason: "awaiting approval" },
    });
    recordArtifact({
      runId: session.id,
      kind: "screenshot",
      path: "/tmp/step-0.png",
      sha256: "abc123",
      metadata: { step: 0 },
    });
    recordModelUsage({
      runId: session.id,
      sessionId: session.id,
      phase: "executor",
      provider: "anthropic",
      model: "claude-test",
      inputTokens: 12,
      outputTokens: 8,
    });

    const timeline = buildSessionTimeline(session.id);

    expect(timeline.run).toEqual(expect.objectContaining({ id: session.id, status: "running" }));
    expect(timeline.items.length).toBeGreaterThanOrEqual(7);
    expect(timeline.counts).toEqual(expect.objectContaining({
      run_step: 1,
      model_decision: 1,
      action: 1,
      approval: 1,
      policy: 1,
      verifier: 1,
      artifact: 1,
      model_usage: 1,
    }));
    expect(timeline.items.map((item) => item.kind)).toContain("verifier");
    expect(timeline.items.find((item) => item.kind === "model_usage")).toEqual(expect.objectContaining({
      tokens: { input: 12, output: 8, total: 20 },
      provider: "anthropic",
      model: "claude-test",
    }));
    expect(JSON.stringify(timeline)).not.toContain("do-not-render-this-secret");
  });
});
