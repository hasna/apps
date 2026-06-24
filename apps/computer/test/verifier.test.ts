import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, listAuditEvents } from "../src/db/index.js";
import { createWorkflowRun, listObservations, listPolicyDecisions } from "../src/agent/runtime.js";
import { verifyGoalState } from "../src/agent/verifier.js";

let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): void {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-verifier-"));
  process.env.COMPUTER_DATA_DIR = tempDir;
  process.env.COMPUTER_DB_PATH = join(tempDir, "computer.db");
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

describe("goal verifier", () => {
  test("persists a done decision with evidence", async () => {
    useTempDb();
    const run = createWorkflowRun({ status: "running" });

    const decision = await verifyGoalState({
      task: "Verify report exists",
      runId: run.id,
      evidence: [
        { kind: "browser_snapshot", summary: "The report page shows Completed successfully." },
      ],
      generator: () => ({
        status: "done",
        confidence: 0.91,
        reason: "Report completion is visible.",
        evidence: ["browser snapshot shows completion"],
      }),
    });

    expect(decision.status).toBe("done");
    expect(listObservations(run.id)[0]).toEqual(expect.objectContaining({ kind: "verifier_decision" }));
    expect(listPolicyDecisions(run.id)[0]).toEqual(expect.objectContaining({ capability: "verifier.goal", decision: "done" }));
    expect(listAuditEvents({ transport: "verifier", capability: "verifier.goal", decision: "done", limit: 1 })).toHaveLength(1);
  });

  test("fallback verifier can request more steps when evidence is insufficient", async () => {
    useTempDb();
    const run = createWorkflowRun({ status: "running" });
    const decision = await verifyGoalState({
      task: "Find the settings page",
      runId: run.id,
      evidence: [
        { kind: "screenshot", summary: "A blank desktop is visible." },
      ],
    });

    expect(decision.status).toBe("needs_more_steps");
    expect(decision.nextStep).toBeString();
    expect(listPolicyDecisions(run.id)[0]).toEqual(expect.objectContaining({ decision: "needs_more_steps" }));
  });
});
