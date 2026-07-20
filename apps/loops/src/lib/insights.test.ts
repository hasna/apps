import { describe, expect, test } from "bun:test";
import type { Loop, LoopRun, WorkflowSpec } from "../types.js";
import { auditRuns, lintLoops, runSummary } from "./insights.js";

const TEST_SECRET = ["sk", "ant", "abcdefghijklmnop"].join("-");

function loop(id: string, name: string, target: Loop["target"]): Loop {
  return {
    id,
    name,
    status: "active",
    schedule: { type: "once", at: "2026-07-20T00:00:00.000Z" },
    target,
    catchUp: "latest",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 60_000,
    leaseMs: 30 * 60_000,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}

function run(overrides: Partial<LoopRun> = {}): LoopRun {
  return {
    id: "run-1",
    loopId: "loop-1",
    loopName: "summary-loop",
    scheduledFor: "2026-07-20T00:00:00.000Z",
    attempt: 1,
    status: "succeeded",
    startedAt: "2026-07-20T00:00:00.000Z",
    finishedAt: "2026-07-20T00:00:01.000Z",
    durationMs: 1_000,
    stdout: `{"usage":{"total_tokens":17,"input_tokens":10,"output_tokens":7}}
${TEST_SECRET}`,
    stderr: "",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:01.000Z",
    ...overrides,
  };
}

describe("agent loop insights", () => {
  test("builds bounded redacted openloops.run_summary.v1 records with artifact refs", () => {
    const value = runSummary(run(), {
      loop: loop("loop-1", "summary-loop", { type: "command", command: "printf", args: ["ok"] }),
      showOutput: true,
      maxOutputChars: 100,
    }) as {
      schema: string;
      tokens: { total: number; input: number; output: number };
      output: { stdout: { ref: string; preview: string; truncated: boolean } };
      artifacts: Array<{ kind: string; ref: string; stream: string; chars: number }>;
    };

    expect(value.schema).toBe("openloops.run_summary.v1");
    expect(value.tokens).toMatchObject({ total: 17, input: 10, output: 7 });
    expect(value.output.stdout.ref).toBe("openloops://runs/run-1/stdout");
    expect(value.output.stdout.preview).toContain("[SCRUBBED]");
    expect(value.output.stdout.preview).not.toContain(TEST_SECRET);
    expect(value.output.stdout.truncated).toBe(false);
    expect(value.artifacts).toContainEqual({
      kind: "output",
      stream: "stdout",
      ref: "openloops://runs/run-1/stdout",
      chars: run().stdout!.length,
    });
  });

  test("groups bounded audits by status, loop, day, and failure family", () => {
    const runs = [
      run(),
      run({
        id: "run-2",
        loopId: "loop-2",
        loopName: "failed-loop",
        status: "failed",
        error: "401 unauthorized",
        createdAt: "2026-07-20T01:00:00.000Z",
        updatedAt: "2026-07-20T01:00:01.000Z",
      }),
    ];

    for (const groupBy of ["status", "loop", "day", "failure-family"] as const) {
      const value = auditRuns(runs, {
        since: "2026-07-19T00:00:00.000Z",
        groupBy,
        drillDownLimit: 1,
        scanLimit: 2,
        hasMore: true,
      }) as {
        schema: string;
        groupBy: string;
        groups: Array<{ key: string; runIds: string[]; truncated: boolean }>;
        hasMore: boolean;
      };
      expect(value.schema).toBe("openloops.audit.v1");
      expect(value.groupBy).toBe(groupBy);
      expect(value.groups.length).toBeGreaterThan(0);
      expect(value.groups.every((group) => group.runIds.length <= 1)).toBe(true);
      expect(value.hasMore).toBe(true);
    }
  });

  test("detects the four frozen lint hazards on loops and workflow steps", () => {
    const wrapper = loop("loop-wrapper", "wrapper", {
      type: "command",
      command: "bash",
      args: ["-c", "cat /tmp/large.log"],
    });
    const encoded = loop("loop-encoded", "encoded", {
      type: "command",
      command: "printf",
      args: ["A".repeat(140), "|", "base64", "-d"],
    });
    const workflowLoop = loop("loop-workflow", "workflow", {
      type: "workflow",
      workflowId: "workflow-1",
    });
    const workflow: WorkflowSpec = {
      id: "workflow-1",
      name: "audit-workflow",
      version: 1,
      status: "active",
      steps: [{ id: "history", target: { type: "command", command: "git", args: ["log"] } }],
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    };

    const value = lintLoops(
      [wrapper, encoded, workflowLoop],
      new Map([[workflow.id, workflow]]),
      { longCommandChars: 100 },
    ) as { schema: string; issues: Array<{ code: string; targetPath: string }> };
    const codes = value.issues.map((issue) => issue.code);

    expect(value.schema).toBe("openloops.lint.v1");
    expect(codes).toContain("wrapper-script");
    expect(codes).toContain("inline-base64");
    expect(codes).toContain("long-command");
    expect(codes).toContain("unbounded-output");
    expect(value.issues).toContainEqual(expect.objectContaining({
      code: "unbounded-output",
      targetPath: "workflow:workflow-1:step:history",
    }));
  });
});
