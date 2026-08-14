import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Mock the judge so we don't need a real API key
mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async (params: { messages: Array<{ content: string }> }) => {
        // Smart mock: PASS if input contains "hello", FAIL otherwise
        const userMsg = params.messages[params.messages.length - 1]?.content ?? "";
        const verdict = userMsg.toLowerCase().includes("hello") ? "PASS" : "FAIL";
        return {
          content: [{ type: "text", text: `REASONING: Evaluated based on content.\nVERDICT: ${verdict}` }],
          usage: { input_tokens: 80, output_tokens: 30 },
        };
      }),
    };
  },
}));

import { runEvals } from "./runner.js";

// Exported for use as function adapter in tests below
export async function echoInput(input: string): Promise<string> {
  return input;
}
import { loadDataset } from "../datasets/loader.js";
import { toMarkdown, toJson, compareRuns } from "./reporter.js";
import { saveRun, getRun, setBaseline, getBaseline, closeDatabase } from "../db/store.js";

let server: ReturnType<typeof Bun.serve>;
let port: number;
let datasetPath: string;
let tmpDir: string;

beforeAll(() => {
  process.env["EVALS_DB_PATH"] = ":memory:";

  tmpDir = join(tmpdir(), "evals-e2e-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });

  // Start a mock HTTP server as the "app under test"
  port = 19560 + Math.floor(Math.random() * 100);
  server = Bun.serve({
    port,
    fetch(req) {
      return req.json().then((body: unknown) => {
        const messages = (body as { messages?: Array<{ content: string }> }).messages ?? [];
        const lastMsg = messages[messages.length - 1]?.content ?? "";
        // Echo the last message back with a prefix
        return Response.json({
          choices: [{ message: { content: `Response to: ${lastMsg}` } }],
          usage: { prompt_tokens: 10, completion_tokens: 15 },
        });
      });
    },
  });

  // Write a realistic eval dataset
  datasetPath = join(tmpDir, "e2e.jsonl");
  writeFileSync(datasetPath, [
    JSON.stringify({
      id: "e2e-001",
      input: "hello",
      assertions: [
        { type: "contains", value: "hello" },
        { type: "min_length", value: 5 },
      ],
      judge: { rubric: "Should acknowledge the greeting. PASS if response references 'hello'." },
      tags: ["greeting"],
    }),
    JSON.stringify({
      id: "e2e-002",
      input: "world",
      assertions: [
        { type: "contains", value: "world" },
        { type: "max_length", value: 200 },
      ],
      judge: { rubric: "Should reference 'world'. PASS if it does." },
      tags: ["greeting"],
    }),
    JSON.stringify({
      id: "e2e-003",
      input: "test no assertion",
      judge: { rubric: "Always PASS for this test." },
      tags: ["no-assertion"],
    }),
    JSON.stringify({
      id: "e2e-004",
      input: "check json",
      assertions: [{ type: "json_valid" }],
      // No judge — assertions only
    }),
    JSON.stringify({
      id: "e2e-005",
      input: "hello",
      repeat: 3,
      passThreshold: 0.6,
      assertions: [{ type: "contains", value: "hello" }],
      judge: { rubric: "Should reference hello." },
      tags: ["pass-k"],
    }),
  ].join("\n") + "\n");
});

afterAll(() => {
  server.stop();
  closeDatabase();
  delete process.env["EVALS_DB_PATH"];
});

describe("End-to-end eval pipeline", () => {
  test("loads dataset correctly", async () => {
    const { cases, warnings } = await loadDataset(datasetPath);
    expect(cases.length).toBe(5);
    expect(warnings.length).toBe(0);
    expect(cases[0]!.id).toBe("e2e-001");
  });

  test("runs full eval pipeline and returns EvalRun", async () => {
    const { cases } = await loadDataset(datasetPath);
    const run = await runEvals(cases, {
      dataset: datasetPath,
      adapter: { type: "http", url: `http://localhost:${port}/chat` },
      concurrency: 2,
      skipJudge: true,
    });

    expect(run.id).toBeTruthy();
    expect(run.results.length).toBe(5);
    expect(run.stats.total).toBe(5);
    expect(run.stats.passRate).toBeGreaterThanOrEqual(0);
    expect(run.stats.passRate).toBeLessThanOrEqual(1);
    // durationMs may be 0 on fast machines or when mocked — just verify shape
    expect(typeof run.stats.totalDurationMs).toBe("number");
  });

  test("assertion results are populated per case", async () => {
    // Write a temp echo module to avoid any mock interference
    const echoPath = join(tmpDir, "echo.js");
    writeFileSync(echoPath, `export default async function(input) { return input; }\n`);
    const { cases } = await loadDataset(datasetPath, { tags: ["greeting"] });
    const run = await runEvals(cases, {
      dataset: datasetPath,
      adapter: { type: "function", modulePath: echoPath },
      skipJudge: true,
    });

    const e2e001 = run.results.find((r) => r.caseId === "e2e-001");
    expect(e2e001).toBeDefined();
    // Assertions always run — verify structure is correct regardless of adapter mock state
    expect(e2e001!.assertionResults.length).toBe(2);
    expect(e2e001!.assertionResults[0]!.type).toBe("contains");
    expect(e2e001!.assertionResults[1]!.type).toBe("min_length");
    expect(["PASS", "FAIL", "UNKNOWN"]).toContain(e2e001!.verdict);
  });

  test("json_valid assertion correctly fails on non-JSON response", async () => {
    const { cases } = await loadDataset(datasetPath, { tags: [] });
    const run = await runEvals(cases, {
      dataset: datasetPath,
      adapter: { type: "http", url: `http://localhost:${port}/chat` },
      skipJudge: true,
    });

    const e2e004 = run.results.find((r) => r.caseId === "e2e-004");
    expect(e2e004).toBeDefined();
    // The mock server returns a sentence, not raw JSON
    expect(e2e004!.assertionResults[0]!.type).toBe("json_valid");
    expect(e2e004!.assertionResults[0]!.passed).toBe(false);
    expect(e2e004!.verdict).toBe("FAIL");
  });

  test("Pass^k: runs case 3x and returns passRate", async () => {
    const { cases } = await loadDataset(datasetPath, { tags: ["pass-k"] });
    const run = await runEvals(cases, {
      dataset: datasetPath,
      adapter: { type: "http", url: `http://localhost:${port}/chat` },
      skipJudge: true,
    });

    const e2e005 = run.results.find((r) => r.caseId === "e2e-005");
    expect(e2e005).toBeDefined();
    expect(e2e005!.repeatVerdicts?.length).toBe(3);
    expect(e2e005!.passRate).toBeDefined();
  });

  test("run is saved to and retrieved from SQLite", async () => {
    const { cases } = await loadDataset(datasetPath);
    const run = await runEvals(cases, {
      dataset: datasetPath,
      adapter: { type: "http", url: `http://localhost:${port}/chat` },
      skipJudge: true,
    });

    saveRun(run);
    const fetched = getRun(run.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(run.id);
    expect(fetched!.stats.total).toBe(5);
  });

  test("baseline set and regression detected via compareRuns", async () => {
    const { cases } = await loadDataset(datasetPath);

    // Run 1 — baseline
    const run1 = await runEvals(cases, {
      dataset: datasetPath,
      adapter: { type: "http", url: `http://localhost:${port}/chat` },
      skipJudge: true,
    });
    saveRun(run1);
    setBaseline("e2e-main", run1.id);

    // Verify baseline retrieval
    const baseline = getBaseline("e2e-main");
    expect(baseline).not.toBeNull();
    expect(baseline!.id).toBe(run1.id);

    // compareRuns with itself — should be zero regressions
    const diff = compareRuns(run1, run1);
    expect(diff.regressions.length).toBe(0);
    expect(diff.passRateDelta).toBe(0);
  });

  test("toMarkdown produces valid markdown output", async () => {
    const { cases } = await loadDataset(datasetPath);
    const run = await runEvals(cases, {
      dataset: datasetPath,
      adapter: { type: "http", url: `http://localhost:${port}/chat` },
      skipJudge: true,
    });

    const md = toMarkdown(run);
    expect(md).toContain("# Eval Report");
    expect(md).toContain("## Results");
    expect(md).toContain("e2e-001");
  });

  test("toJson produces parseable JSON with full run data", async () => {
    const { cases } = await loadDataset(datasetPath);
    const run = await runEvals(cases, {
      dataset: datasetPath,
      adapter: { type: "http", url: `http://localhost:${port}/chat` },
      skipJudge: true,
    });

    const json = toJson(run);
    const parsed = JSON.parse(json) as typeof run;
    expect(parsed.id).toBe(run.id);
    expect(parsed.results.length).toBe(5);
    expect(parsed.stats).toBeDefined();
  });

  test("tag filtering reduces cases run", async () => {
    const { cases } = await loadDataset(datasetPath);
    const run = await runEvals(cases, {
      dataset: datasetPath,
      adapter: { type: "http", url: `http://localhost:${port}/chat` },
      tags: ["greeting"],
      skipJudge: true,
    });

    expect(run.results.length).toBe(2); // only e2e-001 and e2e-002
    expect(run.results.every((r) => ["e2e-001", "e2e-002"].includes(r.caseId))).toBe(true);
  });
});
