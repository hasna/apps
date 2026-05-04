import { describe, expect, it } from "bun:test";
import {
  REAL_CLI_WORKFLOWS,
  evaluateRealCliBenchmark,
  evaluateRealCliWorkflow,
  extractFullOutputPath,
  toRealCliGateEvidence,
  type RealCliWorkflow,
} from "./real-cli-benchmark.js";

const workflow: RealCliWorkflow = {
  id: "search",
  repo: "open-terminal",
  category: "search",
  weight: 1,
  rawCommand: "rg thing src",
  terminalCommand: 'terminal "find thing"',
  requiredPatterns: ["matches"],
  requiresFullOutput: true,
  minReduction: 0.6,
};

describe("real CLI benchmark", () => {
  it("predefines workflows across both target repos before execution", () => {
    expect(REAL_CLI_WORKFLOWS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(REAL_CLI_WORKFLOWS.map((item) => item.repo))).toEqual(new Set(["open-terminal", "iapp-logos"]));
    expect(REAL_CLI_WORKFLOWS.every((item) => item.weight > 0 && item.rawCommand && item.terminalCommand)).toBe(true);
  });

  it("charges a penalty when full-output expansion is required but unavailable", () => {
    const result = evaluateRealCliWorkflow(
      workflow,
      { stdout: "src/a.ts:1:describe test\nsrc/b.ts:2:describe test\n", stderr: "", status: 0 },
      { stdout: "2 matches in 2 files\nSamples:\n- src/a.ts:1 describe test\n", stderr: "", status: 0 },
    );

    expect(result.qualityPassed).toBe(false);
    expect(result.issues).toContain("missing readable full-output expansion");
    expect(result.penaltyTokens).toBe(result.rawTokens);
    expect(result.optimizedTokens).toBeGreaterThan(result.terminalTokens);
  });

  it("fails provider errors instead of counting them as savings", () => {
    const result = evaluateRealCliWorkflow(
      { ...workflow, requiresFullOutput: false },
      { stdout: "long raw output\n".repeat(100), stderr: "", status: 0 },
      { stdout: "cerebras API error 429: queue_exceeded\n", stderr: "", status: 1 },
    );

    expect(result.qualityPassed).toBe(false);
    expect(result.issues).toContain("terminal command exited 1");
    expect(result.issues.some((issue) => issue.includes("cerebras API error"))).toBe(true);
    expect(result.penaltyTokens).toBe(result.rawTokens);
  });

  it("requires per-workflow and per-category floors, not only aggregate savings", () => {
    const pass = evaluateRealCliWorkflow(
      { ...workflow, requiresFullOutput: false, minReduction: 0.8 },
      { stdout: "raw\n".repeat(1000), stderr: "", status: 0 },
      { stdout: "matches\n", stderr: "", status: 0 },
    );
    const weak = evaluateRealCliWorkflow(
      { ...workflow, id: "weak", category: "small", requiresFullOutput: false, minReduction: 0.8 },
      { stdout: "ok\n", stderr: "", status: 0 },
      { stdout: "$ echo ok\nok\n", stderr: "", status: 0 },
    );

    const report = evaluateRealCliBenchmark({
      terminalRealPath: "/usr/local/bin/terminal",
      terminalVersion: "test",
      repos: { "open-terminal": "/repo", "iapp-logos": "/logos" },
      workflows: [pass, weak],
      installedBinaryUsed: true,
    });

    expect(report.totals.weightedTokenReduction).toBeGreaterThan(0.9);
    expect(report.totals.floorFailures).toBeGreaterThan(0);
    expect(report.totals.target90Achieved).toBe(false);
  });

  it("extracts real evidence for the synthetic benchmark gate", () => {
    const report = evaluateRealCliBenchmark({
      terminalRealPath: "/usr/local/bin/terminal",
      terminalVersion: "test",
      repos: { "open-terminal": "/repo", "iapp-logos": "/logos" },
      workflows: [],
      installedBinaryUsed: false,
    });
    expect(toRealCliGateEvidence(report).installedBinaryUsed).toBe(false);
  });

  it("parses full-output hints with compact and legacy labels", () => {
    expect(extractFullOutputPath("[full: ~/.hasna/terminal/outputs/a.txt]")).toContain(".hasna/terminal/outputs/a.txt");
    expect(extractFullOutputPath("[full output: /tmp/a.txt]")).toBe("/tmp/a.txt");
  });
});
