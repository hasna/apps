import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { join } from "path";
import { callMcpAdapter } from "./mcp.js";
import type { McpAdapterConfig } from "../types/index.js";

const fixturePath = fileURLToPath(new URL("./mcp-test-server.fixture.ts", import.meta.url));

function fixtureConfig(tool: string, inputMapping?: Record<string, string>): McpAdapterConfig {
  return {
    type: "mcp",
    command: [process.execPath, fixturePath],
    tool,
    inputMapping,
  };
}

describe("MCP adapter", () => {
  test("calls named tool and returns text output", async () => {
    const result = await callMcpAdapter(
      fixtureConfig("echo"),
      "hello world"
    );
    expect(result.output).toBe("echo: hello world");
    expect(result.error).toBeUndefined();
  });

  test("concatenates multiple text content blocks", async () => {
    const result = await callMcpAdapter(
      fixtureConfig("multi_content"),
      "x"
    );
    expect(result.output).toContain("part one");
    expect(result.output).toContain("part two");
  });

  test("works with JSON output", async () => {
    const result = await callMcpAdapter(
      fixtureConfig("json_tool"),
      "x"
    );
    expect(result.output).toContain('"result"');
  });

  test("uses inputMapping to map input to named argument", async () => {
    const result = await callMcpAdapter(
      fixtureConfig("mapped_tool", { query: "{{input}}" }),
      "search term"
    );
    expect(result.output).toContain("search term");
  });

  test("passes static values in inputMapping", async () => {
    const result = await callMcpAdapter(
      fixtureConfig("mapped_tool", { query: "fixed query" }),
      "ignored input"
    );
    expect(result.output).toContain("fixed query");
  });

  test("returns error on tool execution failure", async () => {
    const result = await callMcpAdapter(
      fixtureConfig("error_tool"),
      "x"
    );
    expect(result.error).toBeTruthy();
    expect(result.output).toBe("");
  });

  test("returns error for empty command", async () => {
    const result = await callMcpAdapter(
      { type: "mcp", command: [], tool: "echo" },
      "x"
    );
    expect(result.error).toContain("command is empty");
  });

  test("tracks durationMs", async () => {
    const result = await callMcpAdapter(
      fixtureConfig("echo"),
      "timing test"
    );
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Runner error-path coverage ───────────────────────────────────────────────

describe("runner — error handling paths", () => {
  test("adapter error returns UNKNOWN verdict", async () => {
    const { runSingleCase } = await import("../core/runner.js");

    // Use a function adapter that throws
    const tmpDir = join(tmpdir(), "evals-runner-err-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const modulePath = join(tmpDir, "throw.js");
    writeFileSync(modulePath, "export default async function() { throw new Error('adapter exploded'); }\n");

    const result = await runSingleCase(
      { id: "err-case", input: "test" },
      { type: "function", modulePath },
      true
    );
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.error).toContain("exploded");
    expect(result.output).toBe("");
  });

  test("adapter error skips assertions and judge", async () => {
    const { runSingleCase } = await import("../core/runner.js");
    const tmpDir = join(tmpdir(), "evals-runner-skip-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const modulePath = join(tmpDir, "throw2.js");
    writeFileSync(modulePath, "export default async function() { throw new Error('boom'); }\n");

    const result = await runSingleCase(
      {
        id: "skip-case",
        input: "test",
        assertions: [{ type: "contains", value: "hello" }],
        judge: { rubric: "Should be good" },
      },
      { type: "function", modulePath },
      false
    );
    expect(result.assertionResults.length).toBe(0); // no assertions ran
    expect(result.judgeResult).toBeUndefined();     // no judge ran
    expect(result.verdict).toBe("UNKNOWN");
  });

  test("runEvals throws when no adapter provided", async () => {
    const { runEvals } = await import("../core/runner.js");
    await expect(
      runEvals([{ id: "t", input: "x" }], { dataset: "test.jsonl" } as never)
    ).rejects.toThrow("No adapter config provided");
  });

  test("runEvals uses per-case adapter override", async () => {
    const { runEvals } = await import("../core/runner.js");
    const tmpDir = join(tmpdir(), "evals-case-adapter-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const modulePath = join(tmpDir, "greet.js");
    writeFileSync(modulePath, "export default async function(input) { return 'greet: ' + input; }\n");

    const run = await runEvals(
      [{
        id: "override-case",
        input: "world",
        adapter: { type: "function", modulePath },  // per-case adapter
        assertions: [{ type: "contains", value: "greet" }],
      }],
      {
        dataset: "test.jsonl",
        adapter: { type: "http", url: "http://localhost:1/unreachable" }, // default (won't be used)
        skipJudge: true,
      }
    );
    expect(run.results[0]!.output).toContain("greet");
    expect(run.results[0]!.verdict).toBe("PASS");
  });
});
