import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "../src/db/index.js";
import { planGoalDryRun } from "../src/agent/goal-planner.js";
import { listObservations, listPolicyDecisions } from "../src/agent/runtime.js";
import {
  buildExecutorSystemPrompt,
  buildPlannerSystemPrompt,
  buildVerifierSystemPrompt,
  PROMPTS,
  PROMPT_VERSION,
} from "../src/agent/prompts.js";
import { runTask } from "../src/agent/loop.js";
import type { ComputerDriver, ComputerProvider, DriverAction, Screenshot } from "../src/types/index.js";

let tempDir: string | null = null;
const savedEnv = new Map<string, string | undefined>();

function useTempDb(): void {
  closeDb();
  savedEnv.clear();
  for (const key of ["COMPUTER_DB_PATH", "COMPUTER_DATA_DIR"] as const) {
    savedEnv.set(key, process.env[key]);
  }
  tempDir = mkdtempSync(join(tmpdir(), "computer-prompts-"));
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

describe("versioned prompts", () => {
  const screenshot: Screenshot = {
    base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    size: { width: 1, height: 1 },
    timestamp: Date.now(),
  };

  function testDriver(): ComputerDriver {
    return {
      getScreenSize: async () => screenshot.size,
      screenshot: async () => screenshot,
      execute: async (_action: DriverAction) => ({ success: true, duration_ms: 0 }),
      dispose: async () => {},
    };
  }

  test("defines all prompt roles with no-bypass safety rules", () => {
    expect(Object.keys(PROMPTS).sort()).toEqual(["executor", "planner", "safety_reviewer", "verifier"]);
    for (const prompt of Object.values(PROMPTS)) {
      expect(prompt.version).toBe(PROMPT_VERSION);
      expect(prompt.rules.join("\n")).toContain("Do not bypass policy");
      expect(prompt.rules.join("\n")).toContain("approval");
    }
    expect(buildPlannerSystemPrompt({ maxSteps: 3, tools: ["computer"] })).toContain(PROMPT_VERSION);
    expect(buildExecutorSystemPrompt({ screenSize: { width: 10, height: 20 } })).toContain("10x20");
    expect(buildVerifierSystemPrompt({ criteria: ["show evidence"] })).toContain("show evidence");
  });

  test("planner persists prompt references in run observations", async () => {
    useTempDb();
    const plan = await planGoalDryRun({
      prompt: "Plan safely",
      maxSteps: 1,
      workspaceRoots: [process.cwd()],
    });
    const observation = listObservations(plan.run.id).find((item) => item.kind === "planner_output");
    expect(observation?.data).toEqual(expect.objectContaining({
      prompts: expect.objectContaining({
        planner: { role: "planner", version: PROMPT_VERSION },
        safety_reviewer: { role: "safety_reviewer", version: PROMPT_VERSION },
      }),
    }));
  });

  test("executor run records prompt metadata and completion policy references", async () => {
    useTempDb();
    const provider: ComputerProvider = {
      name: "anthropic",
      analyze: async () => ({
        action: null,
        reasoning: "completed successfully",
        done: true,
      }),
    };

    const session = await runTask({
      task: "complete with prompt metadata",
      maxSteps: 1,
      dryRun: true,
      driver: testDriver(),
      computerProvider: provider,
    });

    const promptObservation = listObservations(session.id).find((item) => item.kind === "prompt_metadata");
    expect(promptObservation?.data).toEqual(expect.objectContaining({
      prompts: expect.objectContaining({
        executor: { role: "executor", version: PROMPT_VERSION },
        verifier: { role: "verifier", version: PROMPT_VERSION },
        safety_reviewer: { role: "safety_reviewer", version: PROMPT_VERSION },
      }),
    }));
    expect(listPolicyDecisions(session.id).find((item) => item.capability === "computer.complete")?.metadata)
      .toEqual(expect.objectContaining({
        prompts: expect.objectContaining({
          executor: { role: "executor", version: PROMPT_VERSION },
        }),
      }));
  });
});
