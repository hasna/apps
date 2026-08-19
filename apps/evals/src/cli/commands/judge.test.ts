import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Command } from "commander";

// Sol-guided coverage (tests-coverage-sol workflow, evals lane):
//   "Judge tests must mock judgeOnce and assert FAIL exits 1, PASS and UNKNOWN
//    exit 0, raw --json output, and provider/model passthrough."

// ─── Mocked judge module (no provider call) ───────────────────────────────────
const judgeCalls: Array<Record<string, unknown>> = [];
let nextVerdict: "PASS" | "FAIL" | "UNKNOWN" = "PASS";

mock.module("../../core/judge.ts", () => ({
  judgeOnce: mock(async (args: Record<string, unknown>) => {
    judgeCalls.push(args);
    return {
      verdict: nextVerdict,
      reasoning: "mocked reasoning for " + nextVerdict,
      durationMs: 4,
      costUsd: 0.0002,
    };
  }),
}));

import { judgeCommand } from "./judge.js";

interface CliResult {
  stdout: string[];
  exits: number[];
}

async function runJudgeCli(args: string[]): Promise<CliResult> {
  const result: CliResult = { stdout: [], exits: [] };
  const origLog = console.log;
  const origExit = process.exit;
  console.log = (...parts: unknown[]) => { result.stdout.push(parts.map(String).join(" ")); };
  (process as unknown as { exit: unknown }).exit = ((code: number) => { result.exits.push(code); }) as never;
  try {
    const program = new Command("evals").version("0.0.0");
    program.addCommand(judgeCommand().exitOverride());
    program.exitOverride();
    await program.parseAsync(["judge", ...args], { from: "user" });
  } finally {
    console.log = origLog;
    process.exit = origExit;
  }
  return result;
}

beforeEach(() => {
  judgeCalls.length = 0;
  nextVerdict = "PASS";
});

const BASE_ARGS = ["--input", "What is 2+2?", "--output", "4", "--rubric", "Must answer 4"];

describe("evals judge CLI", () => {
  test("FAIL verdict exits 1", async () => {
    nextVerdict = "FAIL";
    const result = await runJudgeCli(BASE_ARGS);
    expect(result.exits).toEqual([1]);
    expect(result.stdout.join("\n")).toContain("FAIL");
  });

  test("PASS verdict exits 0", async () => {
    nextVerdict = "PASS";
    const result = await runJudgeCli(BASE_ARGS);
    expect(result.exits).toEqual([0]);
    expect(result.stdout.join("\n")).toContain("PASS");
  });

  test("UNKNOWN verdict exits 0", async () => {
    nextVerdict = "UNKNOWN";
    const result = await runJudgeCli(BASE_ARGS);
    expect(result.exits).toEqual([0]);
    expect(result.stdout.join("\n")).toContain("UNKNOWN");
  });

  test("--json prints the raw result object", async () => {
    nextVerdict = "PASS";
    const result = await runJudgeCli([...BASE_ARGS, "--json"]);
    const parsed = JSON.parse(result.stdout.join("\n")) as {
      verdict: string;
      reasoning: string;
      durationMs: number;
    };
    expect(parsed.verdict).toBe("PASS");
    expect(parsed.reasoning).toContain("mocked reasoning");
    expect(parsed.durationMs).toBe(4);
  });

  test("--model and --provider flags pass through to judgeOnce", async () => {
    await runJudgeCli([...BASE_ARGS, "--model", "gpt-4o", "--provider", "openai"]);
    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0]!["model"]).toBe("gpt-4o");
    expect(judgeCalls[0]!["provider"]).toBe("openai");
    expect(judgeCalls[0]!["input"]).toBe("What is 2+2?");
    expect(judgeCalls[0]!["output"]).toBe("4");
    expect(judgeCalls[0]!["rubric"]).toBe("Must answer 4");
  });

  test("without flags the documented defaults pass through", async () => {
    await runJudgeCli(BASE_ARGS);
    expect(judgeCalls).toHaveLength(1);
    expect(judgeCalls[0]!["model"]).toBe("claude-sonnet-4-6");
    expect(judgeCalls[0]!["provider"]).toBe("anthropic");
  });

  test("--expected is forwarded to judgeOnce", async () => {
    await runJudgeCli([...BASE_ARGS, "--expected", "must not hallucinate"]);
    expect(judgeCalls[0]!["expected"]).toBe("must not hallucinate");
  });
});
