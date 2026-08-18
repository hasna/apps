import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  REAL_CLI_WORKFLOWS,
  evaluateRealCliBenchmark,
  evaluateRealCliWorkflow,
  extractFullOutputPath,
  extractManifestPath,
  toRealCliGateEvidence,
  type RealCliWorkflow,
} from "./real-cli-benchmark.js";

const workflow: RealCliWorkflow = {
  id: "search",
  repo: "terminal",
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
    expect(new Set(REAL_CLI_WORKFLOWS.map((item) => item.repo))).toEqual(new Set(["terminal", "iapp-logos"]));
    expect(REAL_CLI_WORKFLOWS.every((item) => item.weight > 0 && item.rawCommand && item.terminalCommand)).toBe(true);
  });

  it("charges a penalty when task evidence is required but unavailable", () => {
    const result = evaluateRealCliWorkflow(
      workflow,
      { stdout: "src/a.ts:1:describe test\nsrc/b.ts:2:describe test\n", stderr: "", status: 0 },
      { stdout: "2 matches in 2 files\nSamples:\n- src/a.ts:1 describe test\n", stderr: "", status: 0 },
    );

    expect(result.qualityPassed).toBe(false);
    expect(result.issues).toContain("missing readable task-evidence expansion");
    expect(result.penaltyTokens).toBe(result.rawTokens);
    expect(result.optimizedTokens).toBeGreaterThan(result.terminalTokens);
  });

  it("can require a readable evidence ref without loading it into task tokens", () => {
    const dir = mkdtempSync(join(tmpdir(), "terminal-real-cli-ref-"));
    const rawPath = join(dir, "raw.txt");
    const manifestPath = join(dir, "manifest.txt");
    writeFileSync(rawPath, "src/a.test.ts\nsrc/b.test.ts\n", "utf8");
    writeFileSync(manifestPath, `file refs: 2 files in 1 groups\nraw-ref: ${rawPath}`, "utf8");

    const result = evaluateRealCliWorkflow(
      { ...workflow, requiresFullOutput: false, requiresEvidenceRef: true, requiredPatterns: ["files"] },
      { stdout: "src/a.test.ts\nsrc/b.test.ts\n", stderr: "", status: 0 },
      { stdout: `2 files; areas: src x2\n[manifest: ${manifestPath}]\n`, stderr: "", status: 0 },
    );

    expect(result.qualityPassed).toBe(true);
    expect(result.expansionTokens).toBe(0);
    expect(result.losslessExpansionTokens).toBeGreaterThan(0);
  });

  it("counts compact task evidence separately from lossless raw refs", () => {
    const dir = mkdtempSync(join(tmpdir(), "terminal-real-cli-"));
    const rawPath = join(dir, "raw.txt");
    const manifestPath = join(dir, "manifest.txt");
    const rawOutput = Array.from({ length: 20 }, (_, i) => `src/file-${i}.ts:${i + 1}:describe test`).join("\n");
    writeFileSync(rawPath, rawOutput, "utf8");
    writeFileSync(manifestPath, `search refs: 2 matches in 2 files\nraw-ref: ${rawPath}`, "utf8");

    const result = evaluateRealCliWorkflow(
      workflow,
      { stdout: rawOutput, stderr: "", status: 0 },
      { stdout: `2 matches in 2 files\n[manifest: ${manifestPath}]\n`, stderr: "", status: 0 },
    );

    expect(result.qualityPassed).toBe(true);
    expect(result.expansionTokens).toBeLessThan(result.losslessExpansionTokens);
    expect(result.fullOutputPath).toBe(rawPath);
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
      { ...workflow, requiresFullOutput: false, minReduction: 0.8, weight: 10 },
      { stdout: "raw\n".repeat(1000), stderr: "", status: 0 },
      { stdout: "matches\n", stderr: "", status: 0 },
    );
    const weak = evaluateRealCliWorkflow(
      { ...workflow, id: "weak", category: "small", requiresFullOutput: false, minReduction: 0.8 },
      { stdout: "raw\n".repeat(200), stderr: "", status: 0 },
      { stdout: "raw\n".repeat(140), stderr: "", status: 0 },
    );

    const report = evaluateRealCliBenchmark({
      terminalRealPath: "/usr/local/bin/terminal",
      terminalVersion: "test",
      repos: { "terminal": "/repo", "iapp-logos": "/logos" },
      workflows: [pass, weak],
      installedBinaryUsed: true,
    });

    expect(report.totals.weightedTokenReduction).toBeGreaterThan(0.9);
    expect(report.totals.floorFailures).toBeGreaterThan(0);
    expect(report.totals.target90Achieved).toBe(false);
  });

  it("does not fail floors for tiny outputs that stay within bounded overhead", () => {
    const result = evaluateRealCliWorkflow(
      { ...workflow, requiresFullOutput: false, minReduction: 0.8, requiredPatterns: ["Branch:"] },
      { stdout: "## main...origin/main\n", stderr: "", status: 0 },
      { stdout: "Branch:main clean\n", stderr: "", status: 0 },
    );

    expect(result.tokenReduction).toBeLessThan(0.8);
    expect(result.tinyOutputFloor).toBe(true);
    expect(result.floorPassed).toBe(true);
  });

  it("extracts real evidence for the synthetic benchmark gate", () => {
    const report = evaluateRealCliBenchmark({
      terminalRealPath: "/usr/local/bin/terminal",
      terminalVersion: "test",
      repos: { "terminal": "/repo", "iapp-logos": "/logos" },
      workflows: [],
      installedBinaryUsed: false,
    });
    expect(toRealCliGateEvidence(report).installedBinaryUsed).toBe(false);
  });

  it("parses full-output hints with compact and legacy labels", () => {
    expect(extractFullOutputPath("[full: ~/.hasna/terminal/outputs/a.txt]")).toContain(".hasna/terminal/outputs/a.txt");
    expect(extractFullOutputPath("[full output: /tmp/a.txt]")).toBe("/tmp/a.txt");
    expect(extractManifestPath("[manifest: /tmp/m.txt]")).toBe("/tmp/m.txt");
  });
});
