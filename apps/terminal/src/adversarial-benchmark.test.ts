import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import {
  AUDIT_FINDINGS,
  REQUIRED_WORKFLOWS,
  adversarialScenarios,
  runAdversarialBenchmark,
} from "./adversarial-benchmark.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("adversarial benchmark", () => {
  it("documents why the old benchmark was not trustworthy", () => {
    expect(AUDIT_FINDINGS.length).toBeGreaterThanOrEqual(5);
    expect(AUDIT_FINDINGS.join("\n")).toContain("AI summarization input");
    expect(AUDIT_FINDINGS.join("\n")).toContain("expansion");
  });

  it("keeps the benchmark engine under 700 lines", () => {
    const lines = readFileSync(join(here, "adversarial-benchmark.ts"), "utf8").split("\n").length;
    expect(lines).toBeLessThan(700);
  });

  it("covers every required adversarial workflow", () => {
    const report = runAdversarialBenchmark();
    for (const workflow of REQUIRED_WORKFLOWS) {
      expect(report.requiredWorkflowCoverage[workflow]).toBe(true);
    }
  });

  it("measures overhead that output-only benchmarks miss", () => {
    const report = runAdversarialBenchmark("progressive");
    expect(report.scenarios.some((scenario) => scenario.aiInputTokens > 0)).toBe(true);
    expect(report.scenarios.some((scenario) => scenario.providerCostUsd > 0)).toBe(true);
    expect(report.scenarios.some((scenario) => scenario.expansionTokens > 0)).toBe(true);
    expect(report.scenarios.some((scenario) => scenario.retryTokens > 0)).toBe(true);
  });

  it("does not let the aggregate hide weak or negative categories", () => {
    const baseline = runAdversarialBenchmark("baseline");
    const indexed = runAdversarialBenchmark("indexed");

    expect(baseline.categories.length).toBeGreaterThan(5);
    expect(baseline.totals.worstCaseReduction).toBeLessThan(0);
    expect(baseline.totals.p10Reduction).toBeLessThan(baseline.totals.medianReduction);
    expect(baseline.totals.p90Reduction).toBeGreaterThan(baseline.totals.medianReduction);

    expect(indexed.categories.length).toBe(baseline.categories.length);
    expect(indexed.totals.worstCaseReduction).toBe(0);
    expect(indexed.totals.p10Reduction).toBeLessThan(indexed.totals.medianReduction);
    expect(indexed.totals.p90Reduction).toBeGreaterThan(indexed.totals.medianReduction);
  });

  it("supports the indexed 90 percent target after stress testing hard scenarios", () => {
    const baseline = runAdversarialBenchmark("baseline");
    const progressive = runAdversarialBenchmark("progressive");
    const indexed = runAdversarialBenchmark("indexed");
    const indexedWithRealEvidence = runAdversarialBenchmark("indexed", {
      realCliGate: {
        target90Achieved: true,
        weightedTokenReduction: 0.91,
        qualityFailures: 0,
        floorFailures: 0,
        installedBinaryUsed: true,
        reposCovered: ["open-terminal", "iapp-logos"],
        workflowCount: 12,
      },
    });

    expect(baseline.totals.weightedTokenReduction).toBeLessThan(0.7);
    expect(progressive.totals.weightedTokenReduction).toBeGreaterThanOrEqual(0.9);
    expect(progressive.totals.qualityFailures).toBeGreaterThan(0);
    expect(progressive.totals.target9999QualityAchieved).toBe(false);
    expect(progressive.totals.target90Achieved).toBe(false);
    expect(indexed.totals.weightedTokenReduction).toBeGreaterThanOrEqual(0.9);
    expect(indexed.totals.qualityRate).toBeGreaterThanOrEqual(0.9999);
    expect(indexed.totals.target9999QualityAchieved).toBe(true);
    expect(indexed.totals.syntheticTarget90Achieved).toBe(true);
    expect(indexed.totals.realCliGateAchieved).toBe(false);
    expect(indexed.totals.target90Achieved).toBe(false);
    expect(indexed.totals.defensibleThresholdAchieved).toBe(false);
    expect(indexedWithRealEvidence.totals.realCliGateAchieved).toBe(true);
    expect(indexedWithRealEvidence.totals.target90Achieved).toBe(true);
    expect(indexedWithRealEvidence.totals.defensibleThresholdAchieved).toBe(true);
  });

  it("stress tests hundreds of hard agent terminal scenarios", () => {
    const report = runAdversarialBenchmark("indexed");
    expect(report.totals.scenarioCount).toBeGreaterThanOrEqual(300);
    expect(report.totals.stressScenarioCount).toBeGreaterThanOrEqual(300);
    expect(report.totals.minWorkflowScenarios).toBeGreaterThanOrEqual(10);
    expect(report.scenarios.some((scenario) => scenario.id.startsWith("stress-git-diff-"))).toBe(true);
    expect(report.scenarios.some((scenario) => scenario.id.startsWith("stress-detail-"))).toBe(true);
    expect(report.scenarios.some((scenario) => scenario.id.startsWith("stress-critical-"))).toBe(true);
    expect(report.scenarios.some((scenario) => scenario.id.startsWith("stress-expansion-"))).toBe(true);
  });

  it("keeps critical error markers in compact outputs", () => {
    const report = runAdversarialBenchmark();
    expect(report.totals.qualityFailures).toBe(0);
    expect(report.totals.qualityRate).toBe(1);
    const critical = report.scenarios.find((scenario) => scenario.id === "critical-error-trap");
    expect(critical?.qualityPassed).toBe(true);
  });

  it("keeps no-savings scenarios honest", () => {
    const scenarios = adversarialScenarios();
    expect(scenarios.some((scenario) => scenario.workflow === "small output where compression should not claim savings")).toBe(true);
    expect(scenarios.some((scenario) => scenario.workflow === "already-compact/non-compressible output")).toBe(true);

    const report = runAdversarialBenchmark();
    const small = report.scenarios.find((scenario) => scenario.id === "small-output");
    const compactJson = report.scenarios.find((scenario) => scenario.id === "compact-json");
    expect(small?.netTokensSaved).toBe(0);
    expect(compactJson?.netTokensSaved).toBe(0);
  });
});
