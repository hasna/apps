import { compress } from "./compression.js";
import { clearDiffCache, diffOutput } from "./diff-cache.js";
import { adversarialScenarios } from "./adversarial-scenarios.js";
import {
  AUDIT_FINDINGS,
  REQUIRED_WORKFLOWS,
  type BenchmarkReport,
  type BenchmarkVariant,
  type CategoryResult,
  type Provider,
  type RealCliGateEvidence,
  type Scenario,
  type ScenarioResult,
} from "./adversarial-types.js";
import { stripNoise } from "./noise-filter.js";
import { smartDisplay } from "./smart-display.js";
import { estimateTokens } from "./tokens.js";

export { AUDIT_FINDINGS, REQUIRED_WORKFLOWS } from "./adversarial-types.js";
export type {
  BenchmarkReport,
  BenchmarkVariant,
  CategoryResult,
  Provider,
  RealCliGateEvidence,
  Scenario,
  ScenarioResult,
} from "./adversarial-types.js";
export { adversarialScenarios } from "./adversarial-scenarios.js";

const CONTEXT_TURNS = 5;
const CONSUMER_INPUT_USD_PER_MILLION = 3.0;
const DEFENSIBLE_THRESHOLD = 0.90;
const QUALITY_THRESHOLD = 0.9999;
const MIN_STRESS_SCENARIOS_FOR_90 = 200;
const MIN_WORKFLOW_SCENARIOS_FOR_90 = 10;

const PROVIDER_PRICING: Record<Provider, { input: number; output: number }> = {
  none: { input: 0, output: 0 },
  groq: { input: 0.15, output: 0.60 },
  cerebras: { input: 0.60, output: 1.20 },
};

function compactForScenario(scenario: Scenario, variant: BenchmarkVariant): string {
  if (variant === "indexed" && scenario.indexedCompact) return scenario.indexedCompact;
  if ((variant === "indexed" || variant === "progressive") && scenario.progressiveCompact) return scenario.progressiveCompact;
  if (scenario.strategy === "passthrough") return scenario.raw;
  if (scenario.strategy === "structured") return scenario.compact ?? scenario.raw;
  if (scenario.strategy === "noise") return stripNoise(scenario.raw).cleaned;
  if (scenario.strategy === "compress") return compress(scenario.command, scenario.raw, { maxTokens: scenario.maxTokens ?? 200 }).content;
  if (scenario.strategy === "smart-display") return smartDisplay(scenario.raw.split("\n")).join("\n");
  if (scenario.strategy !== "diff") return scenario.raw;

  clearDiffCache();
  diffOutput(scenario.command, "/benchmark", scenario.previous ?? "");
  const diff = diffOutput(scenario.command, "/benchmark", scenario.raw);
  if (!diff.hasPrevious) return scenario.raw;
  if (diff.unchanged) return diff.diffSummary;
  return [
    diff.diffSummary,
    ...diff.added.slice(0, 20).map((line) => `+ ${line}`),
    ...diff.removed.slice(0, 20).map((line) => `- ${line}`),
  ].join("\n");
}

function providerCost(provider: Provider, inputTokens: number, outputTokens: number): number {
  const rates = PROVIDER_PRICING[provider];
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function variantProvider(scenario: Scenario, variant: BenchmarkVariant): Provider {
  if (variant === "indexed") return scenario.indexedProvider ?? "none";
  if (variant === "progressive") return scenario.progressiveProvider ?? scenario.provider ?? "none";
  return scenario.provider ?? "none";
}

function variantExpansion(scenario: Scenario, variant: BenchmarkVariant): number {
  if (variant === "indexed") return scenario.indexedExpansionRate ?? Math.min(scenario.progressiveExpansionRate ?? scenario.expansionRate ?? 0, 0.04);
  if (variant === "progressive") return scenario.progressiveExpansionRate ?? scenario.expansionRate ?? 0;
  return scenario.expansionRate ?? 0;
}

function variantExpansionCap(scenario: Scenario, variant: BenchmarkVariant): number | undefined {
  if (variant === "indexed") return scenario.indexedExpansionTokenCap ?? Math.min(scenario.progressiveExpansionTokenCap ?? 120, 120);
  if (variant === "progressive") return scenario.progressiveExpansionTokenCap;
  return undefined;
}

function variantRetryOverhead(scenario: Scenario, variant: BenchmarkVariant): string {
  if (variant === "indexed") return scenario.indexedRetryOverhead ?? scenario.progressiveRetryOverhead ?? "";
  if (variant === "progressive") return scenario.progressiveRetryOverhead ?? scenario.retryOverhead ?? "";
  return scenario.retryOverhead ?? "";
}

function scenarioResult(scenario: Scenario, variant: BenchmarkVariant): ScenarioResult {
  const rawTokens = estimateTokens(scenario.raw);
  const compactText = compactForScenario(scenario, variant);
  const compactTokens = estimateTokens(compactText);
  const provider = variantProvider(scenario, variant);
  const usesAi = provider !== "none" && !scenario.providerUnavailable;
  const aiInputTokens = usesAi ? Math.min(rawTokens, 1800) + 220 : 0;
  const aiOutputTokens = usesAi ? compactTokens : 0;
  const rawExpansionTokens = Math.round(rawTokens * variantExpansion(scenario, variant));
  const expansionCap = variantExpansionCap(scenario, variant);
  const expansionTokens = expansionCap === undefined ? rawExpansionTokens : Math.min(rawExpansionTokens, expansionCap);
  const retryTokens = estimateTokens(variantRetryOverhead(scenario, variant));
  const baselineBillableTokens = rawTokens * CONTEXT_TURNS;
  const optimizedBillableTokens = (compactTokens + expansionTokens + retryTokens) * CONTEXT_TURNS + aiInputTokens + aiOutputTokens;
  const baselineCostUsd = (baselineBillableTokens * CONSUMER_INPUT_USD_PER_MILLION) / 1_000_000;
  const providerCostUsd = usesAi ? providerCost(provider, aiInputTokens, aiOutputTokens) : 0;
  const optimizedCostUsd = ((((compactTokens + expansionTokens + retryTokens) * CONTEXT_TURNS) * CONSUMER_INPUT_USD_PER_MILLION) / 1_000_000) + providerCostUsd;
  const missingRequiredPatterns = (scenario.requiredPatterns ?? []).filter((pattern) => !compactText.includes(pattern));

  return {
    id: scenario.id,
    workflow: scenario.workflow,
    category: scenario.category,
    command: scenario.command,
    weight: scenario.weight,
    rawTokens,
    compactTokens,
    aiInputTokens,
    aiOutputTokens,
    expansionTokens,
    retryTokens,
    baselineBillableTokens,
    optimizedBillableTokens,
    netTokensSaved: baselineBillableTokens - optimizedBillableTokens,
    tokenReduction: baselineBillableTokens > 0 ? (baselineBillableTokens - optimizedBillableTokens) / baselineBillableTokens : 0,
    baselineCostUsd,
    optimizedCostUsd,
    providerCostUsd,
    costReduction: baselineCostUsd > 0 ? (baselineCostUsd - optimizedCostUsd) / baselineCostUsd : 0,
    missingRequiredPatterns,
    qualityPassed: missingRequiredPatterns.length === 0,
    notes: scenario.notes,
  };
}

function categoryResults(results: ScenarioResult[]): CategoryResult[] {
  const byCategory = new Map<string, ScenarioResult[]>();
  for (const result of results) byCategory.set(result.category, [...(byCategory.get(result.category) ?? []), result]);
  return [...byCategory.entries()].map(([category, items]) => {
    const weightedRawTokens = items.reduce((sum, item) => sum + item.baselineBillableTokens * item.weight, 0);
    const weightedOptimizedTokens = items.reduce((sum, item) => sum + item.optimizedBillableTokens * item.weight, 0);
    const weightedBaselineCostUsd = items.reduce((sum, item) => sum + item.baselineCostUsd * item.weight, 0);
    const weightedOptimizedCostUsd = items.reduce((sum, item) => sum + item.optimizedCostUsd * item.weight, 0);
    return {
      category,
      scenarios: items.length,
      weightedRawTokens,
      weightedOptimizedTokens,
      tokenReduction: weightedRawTokens > 0 ? (weightedRawTokens - weightedOptimizedTokens) / weightedRawTokens : 0,
      weightedBaselineCostUsd,
      weightedOptimizedCostUsd,
      costReduction: weightedBaselineCostUsd > 0 ? (weightedBaselineCostUsd - weightedOptimizedCostUsd) / weightedBaselineCostUsd : 0,
    };
  }).sort((a, b) => a.category.localeCompare(b.category));
}

export interface AdversarialBenchmarkOptions {
  realCliGate?: RealCliGateEvidence;
}

function realCliGatePassed(evidence: RealCliGateEvidence | undefined): boolean {
  return Boolean(evidence?.target90Achieved
    && evidence.installedBinaryUsed
    && evidence.qualityFailures === 0
    && evidence.floorFailures === 0
    && evidence.reposCovered.includes("open-terminal")
    && evidence.reposCovered.includes("iapp-logos")
    && evidence.workflowCount > 0);
}

export function runAdversarialBenchmark(variant: BenchmarkVariant = "indexed", options: AdversarialBenchmarkOptions = {}): BenchmarkReport {
  const scenarios = adversarialScenarios();
  const results = scenarios.map((scenario) => scenarioResult(scenario, variant));
  const weightedRawTokens = results.reduce((sum, result) => sum + result.baselineBillableTokens * result.weight, 0);
  const weightedOptimizedTokens = results.reduce((sum, result) => sum + result.optimizedBillableTokens * result.weight, 0);
  const weightedBaselineCostUsd = results.reduce((sum, result) => sum + result.baselineCostUsd * result.weight, 0);
  const weightedOptimizedCostUsd = results.reduce((sum, result) => sum + result.optimizedCostUsd * result.weight, 0);
  const weightedTokenReduction = weightedRawTokens > 0 ? (weightedRawTokens - weightedOptimizedTokens) / weightedRawTokens : 0;
  const weightedCostReduction = weightedBaselineCostUsd > 0 ? (weightedBaselineCostUsd - weightedOptimizedCostUsd) / weightedBaselineCostUsd : 0;
  const reductions = results.map((result) => result.tokenReduction);
  const stressScenarioCount = scenarios.filter((scenario) => scenario.stress).length;
  const workflowCounts = REQUIRED_WORKFLOWS.map((workflow) => results.filter((result) => result.workflow === workflow).length);
  const qualityFailures = results.filter((result) => !result.qualityPassed).length;
  const qualityRate = results.length > 0 ? (results.length - qualityFailures) / results.length : 0;
  const qualityPassed = qualityRate >= QUALITY_THRESHOLD;
  const stressGatePassed = stressScenarioCount >= MIN_STRESS_SCENARIOS_FOR_90 && Math.min(...workflowCounts) >= MIN_WORKFLOW_SCENARIOS_FOR_90;
  const syntheticTarget90Achieved = weightedTokenReduction >= 0.9 && qualityPassed && stressGatePassed;
  const realCliGateAchieved = realCliGatePassed(options.realCliGate);

  return {
    variant,
    auditFindings: AUDIT_FINDINGS,
    scenarios: results,
    categories: categoryResults(results),
    requiredWorkflowCoverage: Object.fromEntries(REQUIRED_WORKFLOWS.map((workflow) => [workflow, results.some((result) => result.workflow === workflow)])),
    totals: {
      scenarioCount: results.length,
      weightedRawTokens,
      weightedOptimizedTokens,
      weightedNetTokensSaved: weightedRawTokens - weightedOptimizedTokens,
      weightedTokenReduction,
      weightedBaselineCostUsd,
      weightedOptimizedCostUsd,
      weightedCostReduction,
      worstCaseReduction: Math.min(...reductions),
      medianReduction: percentile(reductions, 50),
      p10Reduction: percentile(reductions, 10),
      p90Reduction: percentile(reductions, 90),
      qualityFailures,
      qualityRate,
      target9999QualityAchieved: qualityPassed,
      syntheticTarget90Achieved,
      realCliGateRequired: true,
      realCliGateAchieved,
      realCliWeightedTokenReduction: options.realCliGate?.weightedTokenReduction,
      realCliQualityFailures: options.realCliGate?.qualityFailures,
      realCliFloorFailures: options.realCliGate?.floorFailures,
      stressScenarioCount,
      minWorkflowScenarios: Math.min(...workflowCounts),
      target90Achieved: syntheticTarget90Achieved && realCliGateAchieved,
      target70Achieved: weightedTokenReduction >= 0.7 && qualityPassed,
      defensibleThreshold: DEFENSIBLE_THRESHOLD,
      defensibleThresholdAchieved: weightedTokenReduction >= DEFENSIBLE_THRESHOLD && qualityPassed && realCliGateAchieved,
    },
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function tokens(value: number): string {
  return Math.round(value).toLocaleString();
}

function scenarioRows(report: BenchmarkReport): ScenarioResult[] {
  if (report.scenarios.length <= 80) return report.scenarios;
  const hard = report.scenarios.slice().sort((a, b) => a.tokenReduction - b.tokenReduction).slice(0, 30);
  const heavy = report.scenarios.slice().sort((a, b) => (b.baselineBillableTokens * b.weight) - (a.baselineBillableTokens * a.weight)).slice(0, 30);
  return [...hard, ...heavy].filter((result, index, rows) => rows.findIndex((candidate) => candidate.id === result.id) === index);
}

export function formatAdversarialReport(report: BenchmarkReport): string {
  const rows = scenarioRows(report);
  const lines = [
    "open-terminal adversarial token benchmark",
    `Variant: ${report.variant}`,
    "",
    "Why the previous benchmark was invalid:",
    ...report.auditFindings.map((finding) => `- ${finding}`),
    "",
    "Coverage:",
    ...REQUIRED_WORKFLOWS.map((workflow) => `- ${report.requiredWorkflowCoverage[workflow] ? "yes" : "NO "} ${workflow}`),
    "",
    report.scenarios.length <= 80 ? "Scenario results:" : `Scenario results: showing ${rows.length} hardest/highest-weight rows out of ${report.scenarios.length}; use --json for all rows.`,
    "id                         category   raw_billable  optimized  token_red  cost_red  quality",
    "-------------------------  ---------  ------------  ---------  ---------  --------  -------",
  ];

  for (const result of rows) {
    lines.push([
      result.id.slice(0, 25).padEnd(25),
      result.category.padEnd(9),
      tokens(result.baselineBillableTokens).padStart(12),
      tokens(result.optimizedBillableTokens).padStart(9),
      pct(result.tokenReduction).padStart(9),
      pct(result.costReduction).padStart(8),
      result.qualityPassed ? "pass" : `FAIL missing ${result.missingRequiredPatterns.join(", ")}`,
    ].join("  "));
  }

  lines.push(
    "",
    "Per-category weighted results:",
    "category   scenarios  raw_billable  optimized  token_red  cost_red",
    "---------  ---------  ------------  ---------  ---------  --------",
  );
  for (const category of report.categories) {
    lines.push([
      category.category.padEnd(9),
      String(category.scenarios).padStart(9),
      tokens(category.weightedRawTokens).padStart(12),
      tokens(category.weightedOptimizedTokens).padStart(9),
      pct(category.tokenReduction).padStart(9),
      pct(category.costReduction).padStart(8),
    ].join("  "));
  }

  lines.push(
    "",
    "Totals:",
    `- scenarios: ${report.totals.scenarioCount}`,
    `- weighted raw billable tokens: ${tokens(report.totals.weightedRawTokens)}`,
    `- weighted optimized billable tokens: ${tokens(report.totals.weightedOptimizedTokens)}`,
    `- weighted net tokens saved: ${tokens(report.totals.weightedNetTokensSaved)}`,
    `- weighted token reduction: ${pct(report.totals.weightedTokenReduction)}`,
    `- weighted cost reduction: ${pct(report.totals.weightedCostReduction)}`,
    `- worst-case scenario reduction: ${pct(report.totals.worstCaseReduction)}`,
    `- median scenario reduction: ${pct(report.totals.medianReduction)}`,
    `- p10/p90 scenario reduction: ${pct(report.totals.p10Reduction)} / ${pct(report.totals.p90Reduction)}`,
    `- quality failures: ${report.totals.qualityFailures}`,
    `- quality rate: ${pct(report.totals.qualityRate)}`,
    `- 99.99% quality target: ${report.totals.target9999QualityAchieved ? "SUPPORTED" : "NOT SUPPORTED"}`,
    `- synthetic 90% target: ${report.totals.syntheticTarget90Achieved ? "SUPPORTED" : "NOT SUPPORTED"}`,
    `- real installed-CLI gate: ${report.totals.realCliGateAchieved ? "SUPPORTED" : "NOT SUPPORTED"}`,
    ...(report.totals.realCliWeightedTokenReduction === undefined ? ["- real installed-CLI evidence: missing"] : [
      `- real installed-CLI reduction: ${pct(report.totals.realCliWeightedTokenReduction)}`,
      `- real installed-CLI quality failures: ${report.totals.realCliQualityFailures ?? 0}`,
      `- real installed-CLI floor failures: ${report.totals.realCliFloorFailures ?? 0}`,
    ]),
    `- stress scenarios: ${report.totals.stressScenarioCount}`,
    `- minimum scenarios per required workflow: ${report.totals.minWorkflowScenarios}`,
    `- 70% target: ${report.totals.target70Achieved ? "SUPPORTED" : "NOT SUPPORTED"}`,
    `- 90% weighted target: ${report.totals.target90Achieved ? "SUPPORTED" : "NOT SUPPORTED"}`,
    `- defensible threshold (${pct(report.totals.defensibleThreshold)}): ${report.totals.defensibleThresholdAchieved ? "pass" : "fail"}`,
    "",
    "Interpretation:",
  );

  if (report.totals.target90Achieved) {
    lines.push(`The ${report.variant} variant supports a 90% weighted token-reduction target with both synthetic coverage and real installed-CLI evidence.`);
  } else if (report.totals.syntheticTarget90Achieved && !report.totals.realCliGateAchieved) {
    lines.push(`The ${report.variant} variant reaches the synthetic 90% threshold, but the real installed-CLI gate is missing or failed, so the 90% claim remains unsupported.`);
  } else if (report.totals.target70Achieved) {
    lines.push(`The ${report.variant} variant supports a 70% weighted token-reduction target while the 90% all-workflows claim remains unsupported.`);
  } else if (report.totals.weightedTokenReduction >= 0.7 && report.totals.qualityFailures > 0) {
    lines.push(`The ${report.variant} variant reaches ${pct(report.totals.weightedTokenReduction)} weighted reduction but fails quality gates with ${report.totals.qualityFailures} missing-marker scenarios.`);
  } else {
    lines.push(`The ${report.variant} variant does not support a 70% weighted target. The defensible weighted reduction is ${pct(report.totals.weightedTokenReduction)}.`);
  }
  lines.push("Scenarios with full-detail expansion, cold starts, provider overhead, and small outputs are still allowed to reduce or reverse savings.");
  return lines.join("\n");
}
