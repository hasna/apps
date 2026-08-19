import { describe, test, expect, mock, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Verdict } from "../../types/index.js";

// Sol-guided coverage (tests-coverage-sol workflow, evals lane):
//   "Use a temporary dataset and a mock judge module or exported seam; do not
//    call a provider. Test cohenKappa perfect agreement 1, single-verdict guard
//    1, chance agreement approximately 0, and negative kappa. Pin kappaLabel at
//    0.8, 0.6, 0.4, and 0.2 boundaries. Invoke the real CLI for zero gold cases
//    and assert exit 1 with metadata.gold_verdict in the message; assert --json
//    shape agreement/kappa/results, --limit truncation, and --verbose output."

// ─── Mocked judge module (no provider call) ───────────────────────────────────
// calibrate.ts imports runJudge from ../../core/judge.js; the module-level mock
// below replaces that module for this test file's graph. The specifier must be
// relative to THIS file and carry the .ts extension: mock.module cannot resolve
// the .js form to judge.ts (measured 2026-08-19).
const judgeCalls: Array<{ input: string; output: string; config: Record<string, unknown> }> = [];
let verdictQueue: Verdict[] = [];

mock.module("../../core/judge.ts", () => ({
  runJudge: mock(async (input: string, output: string, config: Record<string, unknown>) => {
    judgeCalls.push({ input, output, config });
    const verdict = verdictQueue.length > 0 ? verdictQueue.shift()! : "PASS";
    return { verdict, reasoning: "mocked judge reasoning", durationMs: 3, costUsd: 0.0001 };
  }),
}));

// The mocked module is imported lazily; the command factory must be imported
// after mock.module so its graph binds to the mock.
import { calibrateCommand, cohenKappa, kappaLabel } from "./calibrate.js";
import { Command } from "commander";

// ─── In-process CLI harness (commander exitOverride + console/exit capture) ──

function buildProgram(): Command {
  const program = new Command("evals").version("0.0.0");
  program.addCommand(calibrateCommand());
  program.exitOverride();
  return program;
}

interface CliResult {
  stdout: string[];
  stderr: string[];
  exits: number[];
}

async function runCalibrate(args: string[]): Promise<CliResult> {
  const result: CliResult = { stdout: [], stderr: [], exits: [] };
  const origLog = console.log;
  const origErr = console.error;
  const origExit = process.exit;
  console.log = (...parts: unknown[]) => { result.stdout.push(parts.map(String).join(" ")); };
  console.error = (...parts: unknown[]) => { result.stderr.push(parts.map(String).join(" ")); };
  (process as unknown as { exit: unknown }).exit = ((code: number) => { result.exits.push(code); }) as never;
  try {
    await buildProgram().parseAsync(["calibrate", ...args], { from: "user" });
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.exit = origExit;
  }
  return result;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), "evals-calibrate-" + Date.now() + "-" + Math.floor(Math.random() * 1e6));
  mkdirSync(tmpDir, { recursive: true });
  verdictQueue = [];
  judgeCalls.length = 0;
});

function goldFile(name: string, golds: Verdict[]): string {
  const path = join(tmpDir, name);
  const lines = golds.map((v, i) =>
    JSON.stringify({ id: `gold-${i}`, input: `input ${i}`, expected: "ok", metadata: { gold_verdict: v } })
  );
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

function noGoldFile(name: string): string {
  const path = join(tmpDir, name);
  writeFileSync(path, [
    JSON.stringify({ id: "plain-0", input: "x", expected: "y" }),
    JSON.stringify({ id: "plain-1", input: "z", expected: "w" }),
  ].join("\n") + "\n");
  return path;
}

// ─── Cohen's kappa — pure math (exported seam) ────────────────────────────────

describe("cohenKappa", () => {
  test("perfect agreement yields 1", () => {
    const gold: Verdict[] = ["PASS", "FAIL", "UNKNOWN", "PASS"];
    expect(cohenKappa(gold, [...gold])).toBe(1);
  });

  test("single-verdict guard: identical single-verdict sets yield 1, not NaN", () => {
    const gold: Verdict[] = ["PASS", "PASS"];
    expect(cohenKappa(gold, ["PASS", "PASS"])).toBe(1);
  });

  test("chance agreement yields approximately 0", () => {
    // Gold and predicted both split 50/50 PASS/FAIL but never agree pairwise:
    // observed agreement 0.5, expected agreement 0.5 -> kappa exactly 0.
    const gold: Verdict[] = ["PASS", "PASS", "FAIL", "FAIL"];
    const predicted: Verdict[] = ["PASS", "FAIL", "PASS", "FAIL"];
    expect(cohenKappa(gold, predicted)).toBe(0);
  });

  test("worse than chance yields negative kappa", () => {
    expect(cohenKappa(["PASS", "FAIL"], ["FAIL", "PASS"])).toBe(-1);
  });

  test("empty inputs yield 0 (division guard)", () => {
    expect(cohenKappa([], [])).toBe(0);
  });
});

describe("kappaLabel", () => {
  test("pins the 0.8 boundary: >= 0.8 is almost perfect, just below is substantial", () => {
    expect(kappaLabel(0.8)).toContain("almost perfect");
    expect(kappaLabel(0.7999)).toContain("substantial");
  });

  test("pins the 0.6 boundary: >= 0.6 is substantial, just below is moderate", () => {
    expect(kappaLabel(0.6)).toContain("substantial");
    expect(kappaLabel(0.5999)).toContain("moderate");
  });

  test("pins the 0.4 boundary: >= 0.4 is moderate, just below is fair", () => {
    expect(kappaLabel(0.4)).toContain("moderate");
    expect(kappaLabel(0.3999)).toContain("fair");
  });

  test("pins the 0.2 boundary: >= 0.2 is fair, below is slight/unreliable", () => {
    expect(kappaLabel(0.2)).toContain("fair");
    expect(kappaLabel(0.1999)).toContain("slight");
    expect(kappaLabel(-0.5)).toContain("slight");
  });
});

// ─── Calibrate CLI ────────────────────────────────────────────────────────────

describe("evals calibrate CLI", () => {
  test("zero gold cases exits 1 and names metadata.gold_verdict in the message", async () => {
    const gold = noGoldFile("no-gold.jsonl");
    const result = await runCalibrate([gold]);
    expect(result.exits).toEqual([1]);
    expect(result.stderr.join("\n")).toContain("metadata.gold_verdict");
  });

  test("--json reports agreement 1 and kappa 1 for a perfectly matched gold set", async () => {
    const gold = goldFile("perfect.jsonl", ["PASS", "PASS", "FAIL", "FAIL"]);
    verdictQueue = ["PASS", "PASS", "FAIL", "FAIL"];
    const result = await runCalibrate([gold, "--json"]);
    expect(result.exits).toEqual([]);
    const out = JSON.parse(result.stdout.join("\n")) as {
      agreement: number;
      kappa: number;
      results: Array<{ id: string; gold: Verdict; predicted: Verdict; match: boolean }>;
    };
    expect(out.agreement).toBe(1);
    expect(out.kappa).toBe(1);
    expect(out.results).toHaveLength(4);
    expect(out.results[0]).toEqual({ id: "gold-0", gold: "PASS", predicted: "PASS", match: true });
    expect(out.results.every((r) => r.match)).toBe(true);
  });

  test("--json reports chance agreement: agreement 0.5 and kappa 0", async () => {
    const gold = goldFile("chance.jsonl", ["PASS", "PASS", "FAIL", "FAIL"]);
    verdictQueue = ["PASS", "FAIL", "PASS", "FAIL"];
    const result = await runCalibrate([gold, "--json"]);
    const out = JSON.parse(result.stdout.join("\n")) as { agreement: number; kappa: number };
    expect(out.agreement).toBe(0.5);
    expect(out.kappa).toBe(0);
  });

  test("non-JSON output truncates mismatches with --limit and shows all with --verbose", async () => {
    const gold = goldFile("mismatch.jsonl", ["PASS", "PASS", "PASS", "PASS"]);
    verdictQueue = ["FAIL", "FAIL", "FAIL", "FAIL"];

    const limited = await runCalibrate([gold, "--limit", "2"]);
    const limitedOut = limited.stdout.join("\n");
    expect(limitedOut).toContain("Cohen's Kappa");
    expect(limitedOut).toMatch(/2 more mismatches hidden/);

    // The first call consumed the queue; re-arm it for the second arm.
    verdictQueue = ["FAIL", "FAIL", "FAIL", "FAIL"];
    const verbose = await runCalibrate([gold, "--verbose"]);
    const verboseOut = verbose.stdout.join("\n");
    expect(verboseOut).not.toMatch(/more mismatches hidden/);
    // Every mismatch row is shown: 4 distinct gold case ids.
    for (let i = 0; i < 4; i++) expect(verboseOut).toContain(`gold-${i}`);
  });

  test("judge receives the model/provider flags and the case input/output", async () => {
    const gold = goldFile("passthrough.jsonl", ["PASS"]);
    verdictQueue = ["PASS"];
    await runCalibrate([gold, "--model", "gpt-4o", "--provider", "openai"]);

    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0]!.config["model"]).toBe("gpt-4o");
    expect(judgeCalls[0]!.config["provider"]).toBe("openai");
    expect(judgeCalls[0]!.input).toBe("input 0");
  });

  test("judge receives the documented defaults when no flags are passed", async () => {
    const gold = goldFile("defaults.jsonl", ["PASS"]);
    verdictQueue = ["PASS"];
    await runCalibrate([gold]);

    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0]!.config["model"]).toBe("claude-sonnet-4-6");
    expect(judgeCalls[0]!.config["provider"]).toBe("anthropic");
  });
});
