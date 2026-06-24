import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getSession, listAuditEvents } from "../src/db/index.js";
import { planGoalDryRun } from "../src/agent/goal-planner.js";
import {
  listApprovals,
  listObservations,
  listPolicyDecisions,
  listRunSteps,
} from "../src/agent/runtime.js";

let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): void {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-goal-planner-"));
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

describe("AI SDK goal planner dry run", () => {
  test("persists a generated plan without creating a computer-use session", async () => {
    useTempDb();
    const plan = await planGoalDryRun({
      prompt: "Open the browser, inspect status, and prepare a terminal",
      maxSteps: 3,
      workspaceRoots: [process.cwd()],
      generator: () => ({
        title: "Inspect browser and terminal",
        summary: "Offline generated dry-run plan.",
        stopConditions: ["All planned steps are persisted before execution."],
        steps: [
          {
            title: "Record goal",
            intent: "Persist the prompt.",
            toolName: "memory",
            input: {
              scope: "goal",
              title: "Inspect browser and terminal",
              body: "Open the browser, inspect status, and prepare a terminal",
            },
            stopCondition: "Goal memory exists.",
          },
          {
            title: "Check browser",
            intent: "Read browser extension status.",
            toolName: "browser",
            input: { action: "status" },
            stopCondition: "Browser status is known.",
          },
          {
            title: "Prepare terminal",
            intent: "Plan a terminal command in the workspace.",
            toolName: "terminal",
            input: {
              app: "ghostty",
              dir: process.cwd(),
              commands: ["pwd"],
            },
            stopCondition: "A terminal transcript can prove the workspace path.",
          },
        ],
      }),
    });

    expect(plan.run.status).toBe("pending");
    expect(getSession(plan.run.id)).toBeNull();
    expect(listRunSteps(plan.run.id)).toHaveLength(3);
    expect(listRunSteps(plan.run.id).every((step) => step.status === "pending")).toBe(true);
    expect(listObservations(plan.run.id)[0]).toEqual(expect.objectContaining({ kind: "planner_output" }));
    expect(plan.steps[2].route.status).toBe("requires_confirmation");
    expect(listApprovals(plan.run.id)[0]).toEqual(expect.objectContaining({ capability: "terminal.exec", status: "pending" }));
    expect(listPolicyDecisions(plan.run.id).map((decision) => decision.capability)).toContain("terminal.exec");
    expect(listAuditEvents({ transport: "planner", capability: "planner.goal", decision: "planned", limit: 1 })).toHaveLength(1);
  });

  test("fallback planner is bounded and routes mutating steps through approval gates", async () => {
    useTempDb();
    const plan = await planGoalDryRun({
      prompt: "Use the computer fleet to inspect this project",
      maxSteps: 2,
      workspaceRoots: [process.cwd()],
    });

    expect(plan.steps).toHaveLength(2);
    expect(plan.draft.stopConditions).toContain("No OS input is executed during this dry run.");
    expect(getSession(plan.run.id)).toBeNull();
    expect(listRunSteps(plan.run.id).map((step) => step.status)).toEqual(["pending", "pending"]);
  });
});
