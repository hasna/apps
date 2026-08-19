import { describe, test, expect, mock, beforeEach } from "bun:test";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Command } from "commander";

// Sol-guided coverage (tests-coverage-sol workflow, evals lane):
//   "Generate tests should mock @anthropic-ai/sdk and feed JSONL containing
//    non-JSON lines, malformed JSON, records with id plus input or turns, and
//    incomplete records. Assert only valid cases reach the output file,
//    malformed lines are skipped, generated <= requested, count parsing, summary
//    fields, and commander failure when description is missing."

// ─── Mocked Anthropic SDK ─────────────────────────────────────────────────────
let responseText = "";
const sdkCalls: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async (opts: { model: string; messages: Array<{ role: string; content: string }> }) => {
        sdkCalls.push({ model: opts.model, messages: opts.messages });
        return { content: [{ type: "text", text: responseText }] };
      }),
    };
  },
}));

import { generateCommand } from "./generate.js";

interface CliResult {
  stdout: string[];
  exits: number[];
  threw: { message: string; code?: string } | null;
}

/** The action prints a "Generating N eval cases..." line before the JSON summary. */
function lastJson(stdout: string[]): string {
  const joined = stdout.join("\n");
  const start = joined.indexOf("{");
  return start === -1 ? joined : joined.slice(start);
}

async function runGenerate(args: string[]): Promise<CliResult> {
  const result: CliResult = { stdout: [], exits: [], threw: null };
  const origLog = console.log;
  const origExit = process.exit;
  console.log = (...parts: unknown[]) => { result.stdout.push(parts.map(String).join(" ")); };
  (process as unknown as { exit: unknown }).exit = ((code: number) => { result.exits.push(code); }) as never;
  try {
    const program = new Command("evals").version("0.0.0");
    program.addCommand(generateCommand().exitOverride());
    program.exitOverride();
    await program.parseAsync(["generate", ...args], { from: "user" });
  } catch (err) {
    result.threw = {
      message: err instanceof Error ? err.message : String(err),
      code: (err as { code?: string })?.code,
    };
  } finally {
    console.log = origLog;
    process.exit = origExit;
  }
  return result;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), "evals-generate-" + Date.now() + "-" + Math.floor(Math.random() * 1e6));
  mkdirSync(tmpDir, { recursive: true });
  responseText = "";
  sdkCalls.length = 0;
});

// The mocked model output: a preamble line, one malformed JSON line, two valid
// records (input and turns forms), and two incomplete records (no id; id
// without input or turns).
const MIXED_RESPONSE = [
  "Here are your generated cases:",
  '{"id":"gen-001","input":"refund request","expected":"offer a refund","judge":{"rubric":"r"},"tags":["support"]}',
  '{broken json line',
  '{"id":"gen-002","input":"cancel subscription"}',
  '{"id":"gen-003","turns":[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]}',
  '{"input":"missing-id","expected":"nope"}',
  '{"id":"gen-004","expected":"no input or turns"}',
  "",
].join("\n");

describe("evals generate CLI", () => {
  test("only valid records reach the output file; malformed and incomplete lines are skipped", async () => {
    responseText = MIXED_RESPONSE;
    const output = join(tmpDir, "out.jsonl");

    const result = await runGenerate(["--description", "refund policy", "--output", output, "--json"]);
    expect(result.threw).toBeNull();
    expect(result.exits).toEqual([]);

    const written = readFileSync(output, "utf8").trim().split("\n").filter(Boolean);
    // Exactly the three complete records — id+input (gen-001, gen-002) and id+turns
    // (gen-003). The preamble line, the malformed line, the id-less record and the
    // record with no input/turns must all be skipped.
    expect(written).toHaveLength(3);
    const ids = written.map((line) => (JSON.parse(line) as { id: string }).id).sort();
    expect(ids).toEqual(["gen-001", "gen-002", "gen-003"]);

    const summary = JSON.parse(lastJson(result.stdout)) as {
      generated: number;
      requested: number;
      output: string;
      model: string;
      description: string;
    };
    expect(summary.generated).toBe(3);
    // Malformed and incomplete records must never inflate the count.
    expect(summary.generated).toBeLessThanOrEqual(summary.requested);
    expect(summary.requested).toBe(10);
    expect(summary.output).toBe(output);
    expect(summary.model).toBe("claude-sonnet-4-6");
    expect(summary.description).toBe("refund policy");
  });

  test("--count controls the requested number and the prompt sent to the model", async () => {
    responseText = '{"id":"gen-001","input":"x"}\n';
    const output = join(tmpDir, "count.jsonl");

    const result = await runGenerate(["--description", "d", "--count", "5", "--output", output, "--json"]);
    const summary = JSON.parse(lastJson(result.stdout)) as { generated: number; requested: number };
    expect(summary.requested).toBe(5);
    expect(summary.generated).toBe(1);
    expect(sdkCalls).toHaveLength(1);
    expect(sdkCalls[0]!.messages[0]!.content).toContain("Generate 5 eval cases");
  });

  test("model flag is passed through to the SDK", async () => {
    responseText = '{"id":"gen-001","input":"x"}\n';
    await runGenerate(["--description", "d", "--model", "claude-opus-4-6"]);
    expect(sdkCalls[0]!.model).toBe("claude-opus-4-6");
  });

  test("no valid lines still writes an empty output file and reports generated 0", async () => {
    responseText = "no JSON here at all\n";
    const output = join(tmpDir, "empty.jsonl");
    const result = await runGenerate(["--description", "d", "--output", output, "--json"]);
    const summary = JSON.parse(lastJson(result.stdout)) as { generated: number };
    expect(summary.generated).toBe(0);
    expect(existsSync(output)).toBe(true);
  });

  test("missing --description fails commander with the mandatory-option error", async () => {
    const result = await runGenerate([]);
    expect(result.threw).not.toBeNull();
    expect(result.threw!.code).toBe("commander.missingMandatoryOptionValue");
    expect(result.threw!.message).toContain("description");
  });
});
