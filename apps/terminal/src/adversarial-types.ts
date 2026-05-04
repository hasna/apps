export const AUDIT_FINDINGS = [
  "The old benchmark was live-output dependent, so one dirty tree or large git log could dominate the result.",
  "It overweighted a single unbounded git-log rewrite and let that hide weak categories.",
  "It measured compact output length but ignored AI summarization input, AI output, provider cost, retries, and expansion follow-up cost.",
  "It did not include small or already-compact outputs where compression should not claim savings.",
  "It did not include full-detail-required workflows, provider outages, cold-cache starts, or summary-quality traps.",
  "It reported only one aggregate percentage instead of per-category, worst-case, median, and percentile evidence.",
];

export const REQUIRED_WORKFLOWS = [
  "tests passing",
  "tests failing with stack traces",
  "typescript/build errors",
  "lint errors",
  "git status/log/diff/show",
  "rg/search results",
  "file listings and trees",
  "package installs",
  "command retries",
  "repeated test loops with small diffs",
  "huge output",
  "small output where compression should not claim savings",
  "already-compact/non-compressible output",
  "output where full detail is required",
  "AI provider unavailable/rate-limited",
  "cache miss/cold start",
  "expansion/full-output follow-up cost",
  "summary inaccuracies or missing critical errors",
] as const;

export type Provider = "none" | "groq" | "cerebras";
export type Strategy = "passthrough" | "structured" | "noise" | "compress" | "smart-display" | "diff";
export type BenchmarkVariant = "baseline" | "progressive" | "indexed";

export interface Scenario {
  id: string;
  workflow: (typeof REQUIRED_WORKFLOWS)[number];
  category: string;
  command: string;
  weight: number;
  raw: string;
  strategy: Strategy;
  compact?: string;
  previous?: string;
  maxTokens?: number;
  provider?: Provider;
  providerUnavailable?: boolean;
  expansionRate?: number;
  retryOverhead?: string;
  progressiveProvider?: Provider;
  progressiveCompact?: string;
  progressiveExpansionRate?: number;
  progressiveExpansionTokenCap?: number;
  progressiveRetryOverhead?: string;
  indexedProvider?: Provider;
  indexedCompact?: string;
  indexedExpansionRate?: number;
  indexedExpansionTokenCap?: number;
  indexedRetryOverhead?: string;
  requiredPatterns?: string[];
  stress?: boolean;
  notes: string;
}

export interface ScenarioResult {
  id: string;
  workflow: string;
  category: string;
  command: string;
  weight: number;
  rawTokens: number;
  compactTokens: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  expansionTokens: number;
  retryTokens: number;
  baselineBillableTokens: number;
  optimizedBillableTokens: number;
  netTokensSaved: number;
  tokenReduction: number;
  baselineCostUsd: number;
  optimizedCostUsd: number;
  providerCostUsd: number;
  costReduction: number;
  missingRequiredPatterns: string[];
  qualityPassed: boolean;
  notes: string;
}

export interface CategoryResult {
  category: string;
  scenarios: number;
  weightedRawTokens: number;
  weightedOptimizedTokens: number;
  tokenReduction: number;
  weightedBaselineCostUsd: number;
  weightedOptimizedCostUsd: number;
  costReduction: number;
}

export interface BenchmarkReport {
  variant: BenchmarkVariant;
  auditFindings: string[];
  scenarios: ScenarioResult[];
  categories: CategoryResult[];
  requiredWorkflowCoverage: Record<string, boolean>;
  totals: {
    scenarioCount: number;
    weightedRawTokens: number;
    weightedOptimizedTokens: number;
    weightedNetTokensSaved: number;
    weightedTokenReduction: number;
    weightedBaselineCostUsd: number;
    weightedOptimizedCostUsd: number;
    weightedCostReduction: number;
    worstCaseReduction: number;
    medianReduction: number;
    p10Reduction: number;
    p90Reduction: number;
    qualityFailures: number;
    qualityRate: number;
    target9999QualityAchieved: boolean;
    stressScenarioCount: number;
    minWorkflowScenarios: number;
    target90Achieved: boolean;
    target70Achieved: boolean;
    defensibleThreshold: number;
    defensibleThresholdAchieved: boolean;
  };
}
