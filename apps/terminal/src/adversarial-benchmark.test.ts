import { describe, expect, it } from "bun:test";
import {
  AUDIT_FINDINGS,
  REQUIRED_WORKFLOWS,
  adversarialScenarios,
  runAdversarialBenchmark,
} from "./adversarial-benchmark.js";

describe("adversarial benchmark", () => {
  it("documents why the old benchmark was not trustworthy", () => {
    expect(AUDIT_FINDINGS.length).toBeGreaterThanOrEqual(5);
    expect(AUDIT_FINDINGS.join("\n")).toContain("AI summarization input");
    expect(AUDIT_FINDINGS.join("\n")).toContain("expansion");
  });

  it("covers every required adversarial workflow", () => {
    const report = runAdversarialBenchmark();
    for (const workflow of REQUIRED_WORKFLOWS) {
      expect(report.requiredWorkflowCoverage[workflow]).toBe(true);
    }
  });

  it("measures overhead that output-only benchmarks miss", () => {
    const report = runAdversarialBenchmark();
    expect(report.scenarios.some((scenario) => scenario.aiInputTokens > 0)).toBe(true);
    expect(report.scenarios.some((scenario) => scenario.providerCostUsd > 0)).toBe(true);
    expect(report.scenarios.some((scenario) => scenario.expansionTokens > 0)).toBe(true);
    expect(report.scenarios.some((scenario) => scenario.retryTokens > 0)).toBe(true);
  });

  it("does not let the aggregate hide weak or negative categories", () => {
    const baseline = runAdversarialBenchmark("baseline");
    const progressive = runAdversarialBenchmark("progressive");

    expect(baseline.categories.length).toBeGreaterThan(5);
    expect(baseline.totals.worstCaseReduction).toBeLessThan(0);
    expect(baseline.totals.p10Reduction).toBeLessThan(baseline.totals.medianReduction);
    expect(baseline.totals.p90Reduction).toBeGreaterThan(baseline.totals.medianReduction);

    expect(progressive.categories.length).toBe(baseline.categories.length);
    expect(progressive.totals.p10Reduction).toBeLessThanOrEqual(progressive.totals.medianReduction);
    expect(progressive.totals.p90Reduction).toBeGreaterThanOrEqual(progressive.totals.medianReduction);
  });

  it("supports the progressive 70 percent target without inflating it to 90 percent", () => {
    const baseline = runAdversarialBenchmark("baseline");
    const progressive = runAdversarialBenchmark("progressive");

    expect(baseline.totals.weightedTokenReduction).toBeLessThan(0.7);
    expect(baseline.totals.target70Achieved).toBe(false);
    expect(progressive.totals.weightedTokenReduction).toBeGreaterThanOrEqual(0.7);
    expect(progressive.totals.target70Achieved).toBe(true);
    expect(progressive.totals.weightedTokenReduction).toBeLessThan(0.9);
    expect(progressive.totals.target90Achieved).toBe(false);
    expect(progressive.totals.defensibleThresholdAchieved).toBe(true);
  });

  it("keeps critical error markers in compact outputs", () => {
    const report = runAdversarialBenchmark();
    expect(report.totals.qualityFailures).toBe(0);
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
