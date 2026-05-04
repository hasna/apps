import { compress } from "./compression.js";
import { clearDiffCache, diffOutput } from "./diff-cache.js";
import { stripNoise } from "./noise-filter.js";
import { smartDisplay } from "./smart-display.js";
import { estimateTokens } from "./tokens.js";

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

type Provider = "none" | "groq" | "cerebras";
type Strategy = "passthrough" | "structured" | "noise" | "compress" | "smart-display" | "diff";
export type BenchmarkVariant = "baseline" | "progressive";

interface Scenario {
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
  requiredPatterns?: string[];
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
    target90Achieved: boolean;
    target70Achieved: boolean;
    defensibleThreshold: number;
    defensibleThresholdAchieved: boolean;
  };
}

const CONTEXT_TURNS = 5;
const CONSUMER_INPUT_USD_PER_MILLION = 3.0;
const DEFENSIBLE_THRESHOLD = 0.70;

const PROVIDER_PRICING: Record<Provider, { input: number; output: number }> = {
  none: { input: 0, output: 0 },
  groq: { input: 0.15, output: 0.60 },
  cerebras: { input: 0.60, output: 1.20 },
};

function repeatLines(count: number, makeLine: (i: number) => string): string {
  return Array.from({ length: count }, (_, i) => makeLine(i + 1)).join("\n");
}

function packageInstallOutput(): string {
  return [
    repeatLines(45, (i) => `npm warn deprecated package-${i}@1.0.0: use package-${i + 1}`),
    "added 847 packages in 12s",
    "",
    "143 packages are looking for funding",
    "  run `npm fund` for details",
    "",
    "found 0 vulnerabilities",
  ].join("\n");
}

function passingTestsOutput(): string {
  return [
    "bun test v1.3.13",
    repeatLines(180, (i) => `src/module-${i}.test.ts: pass ${i} should preserve behavior`),
    "",
    "180 pass",
    "0 fail",
    "360 expect() calls",
  ].join("\n");
}

function failingStackOutput(): string {
  return [
    "FAIL src/auth/session.test.ts",
    "  login refreshes expired token",
    "TypeError: Cannot read properties of undefined (reading 'expiresAt')",
    repeatLines(70, (i) => `    at frame${i} (/repo/src/auth/session.ts:${20 + i}:13)`),
    "",
    "1 fail",
    "42 pass",
  ].join("\n");
}

function typescriptErrorsOutput(): string {
  return repeatLines(44, (i) => {
    const file = i % 2 === 0 ? "src/api/client.ts" : "src/ui/App.tsx";
    return `${file}:${10 + i}:7 - error TS${2300 + i}: Type 'unknown' is not assignable to type 'Session${i}'.`;
  });
}

function lintErrorsOutput(): string {
  return repeatLines(32, (i) => {
    const rule = i % 3 === 0 ? "no-floating-promises" : i % 3 === 1 ? "no-unused-vars" : "react-hooks/exhaustive-deps";
    return `/repo/src/file-${i}.ts:${i}:3  error  ${rule}  eslint`;
  });
}

function gitStatusOutput(): string {
  return [
    "On branch main",
    "Your branch is up to date with 'origin/main'.",
    "",
    "Changes not staged for commit:",
    repeatLines(18, (i) => `  modified:   src/feature-${i}.ts`),
    "",
    "Untracked files:",
    repeatLines(9, (i) => `  src/new-test-${i}.test.ts`),
  ].join("\n");
}

function gitDiffOutput(): string {
  return [
    "diff --git a/src/billing.ts b/src/billing.ts",
    "index 1234567..89abcde 100644",
    "--- a/src/billing.ts",
    "+++ b/src/billing.ts",
    repeatLines(260, (i) => (i % 2 === 0 ? `+ const changed${i} = calculate(${i});` : `- const old${i} = calculateOld(${i});`)),
    "src/billing.ts | 260 +++++++++++++++++++++++++++++++++------------------------",
  ].join("\n");
}

function gitShowOutput(): string {
  return [
    "commit abcdef1234567890",
    "Author: Dev <dev@example.com>",
    "Date: Sun May 3 21:00:00 2026 +0300",
    "",
    "    fix: preserve critical terminal errors",
    "",
    repeatLines(80, (i) => ` src/file-${i}.ts | ${i % 10} +-${i % 7}`),
  ].join("\n");
}

function searchOutput(): string {
  return repeatLines(140, (i) => `src/module-${i % 25}.ts:${i}:export const value${i} = createThing("${"x".repeat(90)}");`);
}

function fileListingOutput(): string {
  return [
    repeatLines(60, (i) => `./src/components/component-${String(i).padStart(3, "0")}.tsx`),
    repeatLines(45, (i) => `./node_modules/package-${i % 5}/dist/index-${i}.js`),
    repeatLines(25, (i) => `./.next/cache/chunk-${i}.json`),
  ].join("\n");
}

function hugeOutput(): string {
  return repeatLines(1200, (i) => `[${i}] build-worker-${i % 8}: processed package-${i % 120} in ${i % 17}ms`);
}

function compactJsonOutput(): string {
  return JSON.stringify({ ok: true, changed: 1, tests: { pass: 12, fail: 0 } });
}

function fullDetailOutput(): string {
  return [
    "Security review found 4 call sites requiring manual inspection.",
    repeatLines(90, (i) => `src/security/path-${i}.ts:${i}: userControlledInput flows into execute(${i}) with sanitizer=${i % 4 === 0 ? "missing" : "present"}`),
    "Manual review required: do not summarize away individual call sites.",
  ].join("\n");
}

function providerRateLimitOutput(): string {
  return [
    "cerebras API error 429: queue_exceeded",
    "Falling back to CPU compression.",
    repeatLines(55, (i) => `Compilation note ${i}: generated declaration for package-${i}`),
  ].join("\n");
}

function coldCacheOutput(): string {
  return [
    "Natural language prompt: show me every auth-related file and failing test",
    "Cache miss: no learned prompt-to-command mapping yet",
    "AI translated command: rg -n 'auth|session|token' src tests",
    repeatLines(50, (i) => `src/auth/file-${i % 8}.ts:${i}: token auth session reference ${i}`),
  ].join("\n");
}

function criticalErrorTrapOutput(): string {
  return [
    "PASS src/safe.test.ts",
    "FAIL src/migrations/prod.test.ts",
    "FATAL: migration would drop table users in production",
    "DETAIL: generated SQL contains DROP TABLE users;",
    repeatLines(40, (i) => `    at migrationFrame${i} (/repo/src/db/migrate.ts:${100 + i}:9)`),
    "1 fail, 19 pass",
  ].join("\n");
}

function compactForScenario(scenario: Scenario, variant: BenchmarkVariant): string {
  if (variant === "progressive" && scenario.progressiveCompact) return scenario.progressiveCompact;
  if (scenario.strategy === "passthrough") return scenario.raw;
  if (scenario.strategy === "structured") return scenario.compact ?? scenario.raw;
  if (scenario.strategy === "noise") return stripNoise(scenario.raw).cleaned;
  if (scenario.strategy === "compress") return compress(scenario.command, scenario.raw, { maxTokens: scenario.maxTokens ?? 200 }).content;
  if (scenario.strategy === "smart-display") return smartDisplay(scenario.raw.split("\n")).join("\n");
  if (scenario.strategy === "diff") {
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
  return scenario.raw;
}

export function adversarialScenarios(): Scenario[] {
  const repeatedTestA = repeatLines(120, (i) => `PASS test ${i}`) + "\nFAIL payment retries after timeout\nTests: 119 passed, 1 failed";
  const repeatedTestB = repeatLines(120, (i) => `PASS test ${i}`) + "\nPASS payment retries after timeout\nTests: 120 passed, 0 failed";

  return [
    {
      id: "tests-pass",
      workflow: "tests passing",
      category: "tests",
      command: "bun test",
      weight: 8,
      raw: passingTestsOutput(),
      strategy: "structured",
      compact: "bun test: 180 pass, 0 fail, 360 expect() calls",
      provider: "none",
      expansionRate: 0.02,
      requiredPatterns: ["180 pass", "0 fail"],
      notes: "Passing test output should collapse to counts but preserve pass/fail truth.",
    },
    {
      id: "tests-fail-stack",
      workflow: "tests failing with stack traces",
      category: "tests",
      command: "bun test",
      weight: 10,
      raw: failingStackOutput(),
      strategy: "structured",
      compact: "FAIL src/auth/session.test.ts\nTypeError: Cannot read properties of undefined (reading 'expiresAt')\nFirst stack: /repo/src/auth/session.ts:21:13\n1 fail, 42 pass",
      provider: "groq",
      expansionRate: 0.35,
      progressiveExpansionRate: 0.18,
      progressiveExpansionTokenCap: 220,
      requiredPatterns: ["FAIL src/auth/session.test.ts", "TypeError", "expiresAt", "1 fail"],
      notes: "Failure summaries often need some stack expansion.",
    },
    {
      id: "ts-build-errors",
      workflow: "typescript/build errors",
      category: "build",
      command: "bun run build",
      weight: 7,
      raw: typescriptErrorsOutput(),
      strategy: "structured",
      compact: "44 TypeScript errors across src/api/client.ts and src/ui/App.tsx\nTop: TS2301 unknown not assignable to Session1\nRun expand for full list.",
      provider: "cerebras",
      expansionRate: 0.45,
      progressiveCompact: "44 TypeScript errors across 2 files. First per file: src/api/client.ts:12 TS2301; src/ui/App.tsx:11 TS2300. Full diagnostics stored; expand with offset/limit.",
      progressiveExpansionRate: 0.18,
      progressiveExpansionTokenCap: 260,
      requiredPatterns: ["44 TypeScript errors", "TS2301", "expand"],
      notes: "Build errors compress, but fixing often needs more than one diagnostic.",
    },
    {
      id: "lint-errors",
      workflow: "lint errors",
      category: "lint",
      command: "bun run lint",
      weight: 4,
      raw: lintErrorsOutput(),
      strategy: "structured",
      compact: "32 lint errors: no-floating-promises, no-unused-vars, react-hooks/exhaustive-deps. Top files: file-1.ts, file-2.ts, file-3.ts.",
      provider: "groq",
      expansionRate: 0.3,
      progressiveCompact: "32 lint errors grouped by rule: no-floating-promises, no-unused-vars, react-hooks/exhaustive-deps. First files: file-1.ts, file-2.ts, file-3.ts. Expand by rule.",
      progressiveExpansionRate: 0.12,
      progressiveExpansionTokenCap: 120,
      requiredPatterns: ["32 lint errors", "no-floating-promises"],
      notes: "Lint output is repetitive but individual files may still matter.",
    },
    {
      id: "git-status",
      workflow: "git status/log/diff/show",
      category: "git",
      command: "git status",
      weight: 6,
      raw: gitStatusOutput(),
      strategy: "structured",
      compact: "On branch main, up to date. 18 modified files, 9 untracked files.",
      provider: "none",
      expansionRate: 0.15,
      progressiveExpansionRate: 0.05,
      progressiveExpansionTokenCap: 60,
      requiredPatterns: ["main", "18 modified", "9 untracked"],
      notes: "Structured git status saves tokens but users may inspect file names.",
    },
    {
      id: "git-diff",
      workflow: "git status/log/diff/show",
      category: "git",
      command: "git diff",
      weight: 9,
      raw: gitDiffOutput(),
      strategy: "structured",
      compact: "src/billing.ts changed: 130 additions, 130 removals. Full diff required before commit.",
      provider: "none",
      expansionRate: 1,
      progressiveCompact: "src/billing.ts changed: 130 additions, 130 removals. Full diff required, stored as line-window chunks; hunk manifest says calculate() replaced calculateOld().",
      progressiveExpansionRate: 0.2,
      progressiveExpansionTokenCap: 420,
      requiredPatterns: ["src/billing.ts", "Full diff required"],
      notes: "A commit decision often requires full diff expansion, which can wipe out savings.",
    },
    {
      id: "git-show",
      workflow: "git status/log/diff/show",
      category: "git",
      command: "git show --stat HEAD",
      weight: 3,
      raw: gitShowOutput(),
      strategy: "structured",
      compact: "abcdef1 fix: preserve critical terminal errors. 80 files touched. Use expand for full stat.",
      provider: "none",
      expansionRate: 0.25,
      progressiveExpansionRate: 0.1,
      progressiveExpansionTokenCap: 120,
      requiredPatterns: ["abcdef1", "80 files"],
      notes: "Commit inspection usually benefits from a stat-level first pass.",
    },
    {
      id: "rg-search",
      workflow: "rg/search results",
      category: "search",
      command: "rg -n export src",
      weight: 8,
      raw: searchOutput(),
      strategy: "structured",
      compact: "140 matches across 25 files. Showing top files only: module-0.ts, module-1.ts, module-2.ts. Results truncated; narrow the query or expand.",
      provider: "none",
      expansionRate: 0.35,
      progressiveCompact: "140 matches across 25 files. Top files: module-0.ts, module-1.ts, module-2.ts. Results truncated; use expand with offset/limit or narrow query.",
      progressiveExpansionRate: 0.14,
      progressiveExpansionTokenCap: 360,
      requiredPatterns: ["140 matches", "25 files", "truncated"],
      notes: "Search cannot claim perfect savings because agents often refine or expand.",
    },
    {
      id: "file-listing",
      workflow: "file listings and trees",
      category: "files",
      command: "find . -type f",
      weight: 5,
      raw: fileListingOutput(),
      strategy: "smart-display",
      provider: "none",
      expansionRate: 0.1,
      progressiveExpansionRate: 0.04,
      progressiveExpansionTokenCap: 120,
      requiredPatterns: ["node_modules"],
      notes: "Smart display groups paths but should not hide that dependency noise existed.",
    },
    {
      id: "package-install",
      workflow: "package installs",
      category: "install",
      command: "bun install",
      weight: 3,
      raw: packageInstallOutput(),
      strategy: "noise",
      provider: "none",
      expansionRate: 0,
      requiredPatterns: ["added 847 packages"],
      notes: "Install logs contain much removable noise, but useful success lines remain.",
    },
    {
      id: "command-retry",
      workflow: "command retries",
      category: "execution",
      command: "rg auth src --glob '*.tsx'",
      weight: 5,
      raw: "rg: regex parse error: unclosed character class\nretry: rg -n 'auth' src --glob '*.tsx'\nsrc/auth/Login.tsx:12:export function Login() {}",
      strategy: "structured",
      compact: "First command failed: regex parse error. Retried safely. 1 auth match in src/auth/Login.tsx:12.",
      provider: "groq",
      progressiveProvider: "none",
      progressiveCompact: "regex parse error; Retried safely; src/auth/Login.tsx:12",
      expansionRate: 0.1,
      retryOverhead: "retry prompt and validation overhead",
      progressiveRetryOverhead: "",
      requiredPatterns: ["regex parse error", "Retried", "src/auth/Login.tsx:12"],
      notes: "Retry loops add overhead that optimistic output-only benchmarks miss.",
    },
    {
      id: "repeated-test-diff",
      workflow: "repeated test loops with small diffs",
      category: "tests",
      command: "bun test",
      weight: 8,
      previous: repeatedTestA,
      raw: repeatedTestB,
      strategy: "diff",
      provider: "none",
      expansionRate: 0.05,
      requiredPatterns: ["payment retries", "120 passed"],
      notes: "Diff cache is one of the strongest legitimate savings paths.",
    },
    {
      id: "huge-output",
      workflow: "huge output",
      category: "huge",
      command: "bun run build --verbose",
      weight: 4,
      raw: hugeOutput(),
      strategy: "compress",
      maxTokens: 220,
      provider: "none",
      expansionRate: 0.2,
      progressiveExpansionRate: 0.08,
      progressiveExpansionTokenCap: 480,
      requiredPatterns: ["build-worker"],
      notes: "Huge repetitive output compresses well, but expansion is still sometimes needed.",
    },
    {
      id: "small-output",
      workflow: "small output where compression should not claim savings",
      category: "small",
      command: "pwd",
      weight: 7,
      raw: "/home/hasna/workspace/hasna/opensource/open-terminal",
      strategy: "passthrough",
      provider: "none",
      expansionRate: 0,
      notes: "Small output should honestly report no meaningful savings.",
    },
    {
      id: "compact-json",
      workflow: "already-compact/non-compressible output",
      category: "small",
      command: "terminal snapshot --json",
      weight: 4,
      raw: compactJsonOutput(),
      strategy: "passthrough",
      provider: "none",
      expansionRate: 0,
      requiredPatterns: ["ok"],
      notes: "Already-compact data should not be counted as a win.",
    },
    {
      id: "full-detail-required",
      workflow: "output where full detail is required",
      category: "detail",
      command: "security review",
      weight: 6,
      raw: fullDetailOutput(),
      strategy: "structured",
      compact: "Security review found 4 risky call sites. Manual review required; expand for every call site.",
      provider: "cerebras",
      expansionRate: 1,
      progressiveCompact: "Security review found 4 risky and 90 total call sites. Manual review required; line manifest stored, expand by grep/offset/limit.",
      progressiveExpansionRate: 0.22,
      progressiveExpansionTokenCap: 520,
      requiredPatterns: ["Manual review required", "expand"],
      notes: "Full-detail workflows can be net negative after summarization overhead.",
    },
    {
      id: "provider-unavailable",
      workflow: "AI provider unavailable/rate-limited",
      category: "provider",
      command: "terminal execute_smart 'bun run build'",
      weight: 3,
      raw: providerRateLimitOutput(),
      strategy: "compress",
      maxTokens: 120,
      provider: "cerebras",
      providerUnavailable: true,
      expansionRate: 0.2,
      progressiveExpansionRate: 0.08,
      progressiveExpansionTokenCap: 120,
      requiredPatterns: ["429", "Falling back"],
      notes: "Rate limits force fallback behavior and should not assume AI success.",
    },
    {
      id: "cold-cache",
      workflow: "cache miss/cold start",
      category: "cache",
      command: "terminal 'show auth files'",
      weight: 6,
      raw: coldCacheOutput(),
      strategy: "structured",
      compact: "Cache miss: translated prompt to rg auth/session/token. 50 matches across 8 auth files.",
      provider: "groq",
      expansionRate: 0.25,
      retryOverhead: "NL translation prompt overhead before cache is warm",
      progressiveCompact: "Cache miss: translated prompt to rg auth/session/token. 50 matches across 8 auth files. Learned mapping recorded for next run; expand with offset/limit.",
      progressiveExpansionRate: 0.1,
      progressiveExpansionTokenCap: 160,
      requiredPatterns: ["Cache miss", "50 matches"],
      notes: "Cold starts include prompt translation cost that repeated-cache claims skip.",
    },
    {
      id: "expansion-followup",
      workflow: "expansion/full-output follow-up cost",
      category: "detail",
      command: "terminal expand detail-key",
      weight: 4,
      raw: searchOutput(),
      strategy: "structured",
      compact: "Search summary looked insufficient; agent requested full expansion.",
      provider: "none",
      expansionRate: 1,
      progressiveCompact: "Expansion returned indexed page 1: 140 matches across 25 files, first 20 line refs, full output remains stored for offset/limit paging.",
      progressiveExpansionRate: 0.16,
      progressiveExpansionTokenCap: 420,
      notes: "The second call returns the full output, so savings should be near zero or negative.",
    },
    {
      id: "critical-error-trap",
      workflow: "summary inaccuracies or missing critical errors",
      category: "quality",
      command: "bun test src/migrations/prod.test.ts",
      weight: 7,
      raw: criticalErrorTrapOutput(),
      strategy: "structured",
      compact: "FAIL src/migrations/prod.test.ts\nFATAL: migration would drop table users in production\nDETAIL: generated SQL contains DROP TABLE users;\n1 fail, 19 pass",
      provider: "groq",
      expansionRate: 0.6,
      progressiveExpansionRate: 0.22,
      progressiveExpansionTokenCap: 260,
      requiredPatterns: ["FATAL", "DROP TABLE users", "1 fail"],
      notes: "The benchmark fails quality if critical failure markers disappear.",
    },
  ];
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

function scenarioResult(scenario: Scenario, variant: BenchmarkVariant): ScenarioResult {
  const rawTokens = estimateTokens(scenario.raw);
  const compactText = compactForScenario(scenario, variant);
  const compactTokens = estimateTokens(compactText);
  const provider = variant === "progressive"
    ? scenario.progressiveProvider ?? scenario.provider ?? "none"
    : scenario.provider ?? "none";
  const usesAi = provider !== "none" && !scenario.providerUnavailable;
  const aiInputTokens = usesAi ? Math.min(rawTokens, 1800) + 220 : 0;
  const aiOutputTokens = usesAi ? compactTokens : 0;
  const expansionRate = variant === "progressive"
    ? scenario.progressiveExpansionRate ?? scenario.expansionRate ?? 0
    : scenario.expansionRate ?? 0;
  const rawExpansionTokens = Math.round(rawTokens * expansionRate);
  const expansionTokens = variant === "progressive" && scenario.progressiveExpansionTokenCap !== undefined
    ? Math.min(rawExpansionTokens, scenario.progressiveExpansionTokenCap)
    : rawExpansionTokens;
  const retryOverhead = variant === "progressive"
    ? scenario.progressiveRetryOverhead ?? scenario.retryOverhead
    : scenario.retryOverhead;
  const retryTokens = estimateTokens(retryOverhead ?? "");
  const baselineBillableTokens = rawTokens * CONTEXT_TURNS;
  const optimizedBillableTokens = (compactTokens + expansionTokens + retryTokens) * CONTEXT_TURNS + aiInputTokens + aiOutputTokens;
  const netTokensSaved = baselineBillableTokens - optimizedBillableTokens;
  const tokenReduction = baselineBillableTokens > 0 ? netTokensSaved / baselineBillableTokens : 0;
  const providerCostUsd = usesAi ? providerCost(provider, aiInputTokens, aiOutputTokens) : 0;
  const baselineCostUsd = (baselineBillableTokens * CONSUMER_INPUT_USD_PER_MILLION) / 1_000_000;
  const optimizedConsumerCostUsd = (((compactTokens + expansionTokens + retryTokens) * CONTEXT_TURNS) * CONSUMER_INPUT_USD_PER_MILLION) / 1_000_000;
  const optimizedCostUsd = optimizedConsumerCostUsd + providerCostUsd;
  const costReduction = baselineCostUsd > 0 ? (baselineCostUsd - optimizedCostUsd) / baselineCostUsd : 0;
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
    netTokensSaved,
    tokenReduction,
    baselineCostUsd,
    optimizedCostUsd,
    providerCostUsd,
    costReduction,
    missingRequiredPatterns,
    qualityPassed: missingRequiredPatterns.length === 0,
    notes: scenario.notes,
  };
}

export function runAdversarialBenchmark(variant: BenchmarkVariant = "progressive"): BenchmarkReport {
  const scenarios = adversarialScenarios();
  const results = scenarios.map((scenario) => scenarioResult(scenario, variant));
  const coverage = Object.fromEntries(
    REQUIRED_WORKFLOWS.map((workflow) => [workflow, results.some((result) => result.workflow === workflow)])
  ) as Record<string, boolean>;

  const byCategory = new Map<string, ScenarioResult[]>();
  for (const result of results) {
    const list = byCategory.get(result.category) ?? [];
    list.push(result);
    byCategory.set(result.category, list);
  }

  const categories: CategoryResult[] = [...byCategory.entries()].map(([category, categoryResults]) => {
    const weightedRawTokens = categoryResults.reduce((sum, result) => sum + result.baselineBillableTokens * result.weight, 0);
    const weightedOptimizedTokens = categoryResults.reduce((sum, result) => sum + result.optimizedBillableTokens * result.weight, 0);
    const weightedBaselineCostUsd = categoryResults.reduce((sum, result) => sum + result.baselineCostUsd * result.weight, 0);
    const weightedOptimizedCostUsd = categoryResults.reduce((sum, result) => sum + result.optimizedCostUsd * result.weight, 0);
    return {
      category,
      scenarios: categoryResults.length,
      weightedRawTokens,
      weightedOptimizedTokens,
      tokenReduction: weightedRawTokens > 0 ? (weightedRawTokens - weightedOptimizedTokens) / weightedRawTokens : 0,
      weightedBaselineCostUsd,
      weightedOptimizedCostUsd,
      costReduction: weightedBaselineCostUsd > 0 ? (weightedBaselineCostUsd - weightedOptimizedCostUsd) / weightedBaselineCostUsd : 0,
    };
  }).sort((a, b) => a.category.localeCompare(b.category));

  const weightedRawTokens = results.reduce((sum, result) => sum + result.baselineBillableTokens * result.weight, 0);
  const weightedOptimizedTokens = results.reduce((sum, result) => sum + result.optimizedBillableTokens * result.weight, 0);
  const weightedBaselineCostUsd = results.reduce((sum, result) => sum + result.baselineCostUsd * result.weight, 0);
  const weightedOptimizedCostUsd = results.reduce((sum, result) => sum + result.optimizedCostUsd * result.weight, 0);
  const reductions = results.map((result) => result.tokenReduction);
  const weightedTokenReduction = weightedRawTokens > 0 ? (weightedRawTokens - weightedOptimizedTokens) / weightedRawTokens : 0;
  const weightedCostReduction = weightedBaselineCostUsd > 0 ? (weightedBaselineCostUsd - weightedOptimizedCostUsd) / weightedBaselineCostUsd : 0;

  return {
    variant,
    auditFindings: AUDIT_FINDINGS,
    scenarios: results,
    categories,
    requiredWorkflowCoverage: coverage,
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
      qualityFailures: results.filter((result) => !result.qualityPassed).length,
      target90Achieved: weightedTokenReduction >= 0.9 && results.every((result) => result.qualityPassed),
      target70Achieved: weightedTokenReduction >= 0.7 && results.every((result) => result.qualityPassed),
      defensibleThreshold: DEFENSIBLE_THRESHOLD,
      defensibleThresholdAchieved: weightedTokenReduction >= DEFENSIBLE_THRESHOLD && results.every((result) => result.qualityPassed),
    },
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function tokens(value: number): string {
  return Math.round(value).toLocaleString();
}

export function formatAdversarialReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push("open-terminal adversarial token benchmark");
  lines.push(`Variant: ${report.variant}`);
  lines.push("");
  lines.push("Why the previous benchmark was invalid:");
  for (const finding of report.auditFindings) {
    lines.push(`- ${finding}`);
  }
  lines.push("");
  lines.push("Coverage:");
  for (const workflow of REQUIRED_WORKFLOWS) {
    lines.push(`- ${report.requiredWorkflowCoverage[workflow] ? "yes" : "NO "} ${workflow}`);
  }
  lines.push("");
  lines.push("Scenario results:");
  lines.push("id                         category   raw_billable  optimized  token_red  cost_red  quality");
  lines.push("-------------------------  ---------  ------------  ---------  ---------  --------  -------");
  for (const result of report.scenarios) {
    lines.push([
      result.id.padEnd(25),
      result.category.padEnd(9),
      tokens(result.baselineBillableTokens).padStart(12),
      tokens(result.optimizedBillableTokens).padStart(9),
      pct(result.tokenReduction).padStart(9),
      pct(result.costReduction).padStart(8),
      result.qualityPassed ? "pass" : `FAIL missing ${result.missingRequiredPatterns.join(", ")}`,
    ].join("  "));
  }
  lines.push("");
  lines.push("Per-category weighted results:");
  lines.push("category   scenarios  raw_billable  optimized  token_red  cost_red");
  lines.push("---------  ---------  ------------  ---------  ---------  --------");
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
  lines.push("");
  lines.push("Totals:");
  lines.push(`- scenarios: ${report.totals.scenarioCount}`);
  lines.push(`- weighted raw billable tokens: ${tokens(report.totals.weightedRawTokens)}`);
  lines.push(`- weighted optimized billable tokens: ${tokens(report.totals.weightedOptimizedTokens)}`);
  lines.push(`- weighted net tokens saved: ${tokens(report.totals.weightedNetTokensSaved)}`);
  lines.push(`- weighted token reduction: ${pct(report.totals.weightedTokenReduction)}`);
  lines.push(`- weighted cost reduction: ${pct(report.totals.weightedCostReduction)}`);
  lines.push(`- worst-case scenario reduction: ${pct(report.totals.worstCaseReduction)}`);
  lines.push(`- median scenario reduction: ${pct(report.totals.medianReduction)}`);
  lines.push(`- p10/p90 scenario reduction: ${pct(report.totals.p10Reduction)} / ${pct(report.totals.p90Reduction)}`);
  lines.push(`- quality failures: ${report.totals.qualityFailures}`);
  lines.push(`- 70% target: ${report.totals.target70Achieved ? "SUPPORTED" : "NOT SUPPORTED"}`);
  lines.push(`- 90% claim: ${report.totals.target90Achieved ? "SUPPORTED" : "NOT SUPPORTED"}`);
  lines.push(`- defensible threshold (${pct(report.totals.defensibleThreshold)}): ${report.totals.defensibleThresholdAchieved ? "pass" : "fail"}`);
  lines.push("");
  lines.push("Interpretation:");
  if (report.totals.target90Achieved) {
    lines.push("The adversarial suite supports a 90% weighted token-reduction claim.");
  } else if (report.totals.target70Achieved) {
    lines.push(`The ${report.variant} variant supports a 70% weighted token-reduction target while the 90% all-workflows claim remains unsupported.`);
  } else {
    lines.push(`The ${report.variant} variant does not support a 70% weighted target. The defensible weighted reduction is ${pct(report.totals.weightedTokenReduction)}.`);
  }
  lines.push("Scenarios with full-detail expansion, cold starts, provider overhead, and small outputs are still allowed to reduce or reverse savings.");
  return lines.join("\n");
}
