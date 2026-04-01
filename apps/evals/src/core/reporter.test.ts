import { describe, test, expect } from "bun:test";
import { printTerminalReport, toJson, toMarkdown, compareRuns, printDiffReport } from "./reporter.js";
import type { EvalRun } from "../types/index.js";

function makeRun(id: string, overrides: Partial<EvalRun["stats"]> = {}): EvalRun {
  return {
    id,
    createdAt: "2026-04-01T12:00:00.000Z",
    dataset: "smoke.jsonl",
    results: [
      {
        caseId: "t1",
        verdict: "PASS",
        output: "Response to: hello",
        assertionResults: [{ type: "contains", passed: true, reason: "Output contains hello" }],
        durationMs: 120,
        costUsd: 0.001,
      },
      {
        caseId: "t2",
        verdict: "FAIL",
        output: "Something else",
        assertionResults: [{ type: "contains", passed: false, reason: 'Output does not contain "4"' }],
        judgeResult: {
          verdict: "FAIL",
          reasoning: "The output does not address the question correctly.",
          durationMs: 800,
          costUsd: 0.002,
        },
        durationMs: 920,
        costUsd: 0.002,
      },
      {
        caseId: "t3",
        verdict: "UNKNOWN",
        output: "Ambiguous",
        assertionResults: [],
        judgeResult: { verdict: "UNKNOWN", reasoning: "Cannot determine.", durationMs: 500 },
        durationMs: 500,
        error: undefined,
      },
    ],
    stats: {
      total: 3,
      passed: 1,
      failed: 1,
      unknown: 1,
      errors: 0,
      passRate: 1 / 3,
      totalDurationMs: 1540,
      totalCostUsd: 0.003,
      totalTokens: 150,
      ...overrides,
    },
  };
}

describe("toJson", () => {
  test("serializes EvalRun to JSON string", () => {
    const run = makeRun("run-001");
    const json = toJson(run);
    const parsed = JSON.parse(json) as EvalRun;
    expect(parsed.id).toBe("run-001");
    expect(parsed.results.length).toBe(3);
    expect(parsed.stats.passRate).toBeCloseTo(1 / 3);
  });

  test("JSON is prettily formatted (has newlines)", () => {
    expect(toJson(makeRun("r"))).toContain("\n");
  });
});

describe("toMarkdown", () => {
  test("includes report header", () => {
    const md = toMarkdown(makeRun("run-md"));
    expect(md).toContain("# Eval Report");
    expect(md).toContain("## Results");
  });

  test("includes run ID and dataset", () => {
    const md = toMarkdown(makeRun("abcdef1234"));
    expect(md).toContain("abcdef12");
    expect(md).toContain("smoke.jsonl");
  });

  test("includes pass rate", () => {
    const md = toMarkdown(makeRun("r"));
    expect(md).toContain("33.3%");
  });

  test("includes Failures section for failed/unknown cases", () => {
    const md = toMarkdown(makeRun("r"));
    expect(md).toContain("## Failures");
    expect(md).toContain("t2");
  });

  test("includes judge reasoning in failures", () => {
    const md = toMarkdown(makeRun("r"));
    expect(md).toContain("does not address the question");
  });

  test("includes cost when non-zero", () => {
    const md = toMarkdown(makeRun("r"));
    expect(md).toContain("$0.003");
  });
});

describe("printTerminalReport", () => {
  test("runs without throwing and outputs lines", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    printTerminalReport(makeRun("r-terminal"));
    console.log = orig;
    expect(lines.length).toBeGreaterThan(3);
    const output = lines.join("\n");
    expect(output).toContain("t1");
    expect(output).toContain("t2");
  });

  test("shows 100% score in green for perfect runs", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    const perfectRun = makeRun("perfect", { passed: 3, failed: 0, unknown: 0, passRate: 1 });
    printTerminalReport(perfectRun);
    console.log = orig;
    const out = lines.join("\n");
    expect(out).toContain("3/3");
  });

  test("shows error details for errored cases", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    const run = makeRun("err-run");
    run.results[0]!.error = "Connection refused";
    run.results[0]!.verdict = "UNKNOWN";
    printTerminalReport(run);
    console.log = orig;
    expect(lines.join("\n")).toContain("Connection refused");
  });
});

describe("compareRuns", () => {
  test("detects regression when PASS → FAIL", () => {
    const before = makeRun("before");
    const after = makeRun("after");
    after.results[0]!.verdict = "FAIL";
    after.stats.passed = 0; after.stats.failed = 2; after.stats.passRate = 0;
    const diff = compareRuns(before, after);
    expect(diff.regressions.some(r => r.caseId === "t1")).toBe(true);
    expect(diff.regressions[0]!.before).toBe("PASS");
    expect(diff.regressions[0]!.after).toBe("FAIL");
  });

  test("detects improvement when FAIL → PASS", () => {
    const before = makeRun("before");
    const after = makeRun("after");
    after.results[1]!.verdict = "PASS";
    after.stats.passed = 2; after.stats.failed = 0; after.stats.passRate = 2 / 3;
    const diff = compareRuns(before, after);
    expect(diff.improvements.some(i => i.caseId === "t2")).toBe(true);
  });

  test("passRateDelta is correct", () => {
    const before = makeRun("b", { passRate: 0.5 });
    const after = makeRun("a", { passRate: 0.75 });
    const diff = compareRuns(before, after);
    expect(diff.passRateDelta).toBeCloseTo(0.25);
  });

  test("scoreDelta reflects change in passed count", () => {
    const before = makeRun("b", { passed: 1 });
    const after = makeRun("a", { passed: 3 });
    const diff = compareRuns(before, after);
    expect(diff.scoreDelta).toBe(2);
  });

  test("no regressions or improvements for identical runs", () => {
    const run = makeRun("same");
    const diff = compareRuns(run, run);
    expect(diff.regressions.length).toBe(0);
    expect(diff.improvements.length).toBe(0);
    expect(diff.passRateDelta).toBe(0);
  });
});

describe("printDiffReport", () => {
  test("prints 'No changes' for identical runs", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    printDiffReport({ regressions: [], improvements: [], scoreDelta: 0, passRateDelta: 0 });
    console.log = orig;
    expect(lines.join("\n")).toContain("No changes");
  });

  test("prints regressions and improvements", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    printDiffReport({
      regressions: [{ caseId: "t1", before: "PASS", after: "FAIL" }],
      improvements: [{ caseId: "t2", before: "FAIL", after: "PASS" }],
      scoreDelta: 0,
      passRateDelta: 0,
    });
    console.log = orig;
    const out = lines.join("\n");
    expect(out).toContain("REGRESSION");
    expect(out).toContain("IMPROVEMENT");
    expect(out).toContain("t1");
    expect(out).toContain("t2");
  });
});
