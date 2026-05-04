import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { estimateTokens } from "./tokens.js";

export const REAL_CLI_OVERALL_TARGET = 0.9;
export const REAL_CLI_CATEGORY_FLOOR = 0.7;
export const REAL_CLI_TINY_RAW_TOKEN_THRESHOLD = 100;
export const REAL_CLI_TINY_MAX_OVERHEAD_TOKENS = 8;

export interface RealCliWorkflow {
  id: string;
  repo: "open-terminal" | "iapp-logos";
  category: string;
  weight: number;
  rawCommand: string;
  terminalCommand: string;
  requiredPatterns: string[];
  forbiddenPatterns?: string[];
  requiresFullOutput?: boolean;
  minReduction: number;
}

export interface RealCliRunOutput {
  stdout: string;
  stderr: string;
  status: number;
}

export interface RealCliWorkflowResult extends RealCliWorkflow {
  rawTokens: number;
  terminalTokens: number;
  expansionTokens: number;
  penaltyTokens: number;
  optimizedTokens: number;
  tokenReduction: number;
  rawStatus: number;
  terminalStatus: number;
  fullOutputPath?: string;
  manifestPath?: string;
  qualityPassed: boolean;
  floorPassed: boolean;
  tinyOutputFloor: boolean;
  issues: string[];
}

export interface RealCliCategoryResult {
  category: string;
  workflows: number;
  weightedRawTokens: number;
  weightedOptimizedTokens: number;
  tokenReduction: number;
  floor: number;
  passed: boolean;
}

export interface RealCliBenchmarkReport {
  generatedAt: string;
  terminalBinary: string;
  terminalRealPath: string;
  terminalVersion: string;
  repos: Record<string, string>;
  workflows: RealCliWorkflowResult[];
  categories: RealCliCategoryResult[];
  totals: {
    workflowCount: number;
    weightedRawTokens: number;
    weightedOptimizedTokens: number;
    weightedNetTokensSaved: number;
    weightedTokenReduction: number;
    qualityFailures: number;
    floorFailures: number;
    overallTarget: number;
    categoryFloor: number;
    tinyRawTokenThreshold: number;
    tinyMaxOverheadTokens: number;
    installedBinaryUsed: boolean;
    reposCovered: string[];
    target90Achieved: boolean;
  };
}

export interface RealCliGateEvidence {
  target90Achieved: boolean;
  weightedTokenReduction: number;
  qualityFailures: number;
  floorFailures: number;
  installedBinaryUsed: boolean;
  reposCovered: string[];
  workflowCount: number;
}

export const REAL_CLI_WORKFLOWS: RealCliWorkflow[] = [
  {
    id: "ot-repo-status",
    repo: "open-terminal",
    category: "git",
    weight: 4,
    rawCommand: "git status --short --branch",
    terminalCommand: "terminal repo",
    requiredPatterns: ["Branch:"],
    minReduction: 0.8,
  },
  {
    id: "ot-project-overview",
    repo: "open-terminal",
    category: "orientation",
    weight: 4,
    rawCommand: "cat package.json && find src -maxdepth 2 -type f | sort",
    terminalCommand: "terminal overview",
    requiredPatterns: ["@hasna/terminal", "Scripts", "Source"],
    minReduction: 0.8,
  },
  {
    id: "ot-change-summary",
    repo: "open-terminal",
    category: "git",
    weight: 5,
    rawCommand: "git status --short --branch && git diff --stat",
    terminalCommand: 'terminal "summarize the current changes"',
    requiredPatterns: ["Branch:"],
    minReduction: 0.75,
  },
  {
    id: "ot-test-discovery",
    repo: "open-terminal",
    category: "tests",
    weight: 5,
    rawCommand: "find . \\( -path './node_modules' -o -path './dist' -o -path './.git' \\) -prune -o \\( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \\) -type f -print | sort",
    terminalCommand: 'terminal "what tests exist"',
    requiredPatterns: ["files"],
    requiresFullOutput: true,
    minReduction: 0.6,
  },
  {
    id: "ot-debug-search",
    repo: "open-terminal",
    category: "search",
    weight: 7,
    rawCommand: 'rg -n "TODO|FIXME|throw new|console\\\\.error|describe" src package.json',
    terminalCommand: 'terminal "find TODOs and tests"',
    requiredPatterns: ["matches"],
    requiresFullOutput: true,
    minReduction: 0.65,
  },
  {
    id: "ot-source-structure",
    repo: "open-terminal",
    category: "files",
    weight: 4,
    rawCommand: "find src -maxdepth 2 -type f | sort",
    terminalCommand: 'terminal "show source structure"',
    requiredPatterns: ["files"],
    requiresFullOutput: true,
    minReduction: 0.6,
  },
  {
    id: "logos-repo-status",
    repo: "iapp-logos",
    category: "git",
    weight: 4,
    rawCommand: "git status --short --branch",
    terminalCommand: "terminal repo",
    requiredPatterns: ["Branch:"],
    minReduction: 0.8,
  },
  {
    id: "logos-project-overview",
    repo: "iapp-logos",
    category: "orientation",
    weight: 4,
    rawCommand: "cat package.json && find src -maxdepth 2 -type f | sort",
    terminalCommand: "terminal overview",
    requiredPatterns: ["@hasna/brands", "Scripts", "Source"],
    minReduction: 0.8,
  },
  {
    id: "logos-change-summary",
    repo: "iapp-logos",
    category: "git",
    weight: 5,
    rawCommand: "git status --short --branch && git diff --stat",
    terminalCommand: 'terminal "summarize the current changes"',
    requiredPatterns: ["Branch:", "changed"],
    minReduction: 0.75,
  },
  {
    id: "logos-test-discovery",
    repo: "iapp-logos",
    category: "tests",
    weight: 5,
    rawCommand: "find . \\( -path './node_modules' -o -path './dist' -o -path './.git' \\) -prune -o \\( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \\) -type f -print | sort",
    terminalCommand: 'terminal "what tests exist"',
    requiredPatterns: ["files"],
    requiresFullOutput: true,
    minReduction: 0.6,
  },
  {
    id: "logos-debug-search",
    repo: "iapp-logos",
    category: "search",
    weight: 7,
    rawCommand: 'rg -n "TODO|FIXME|throw new|console\\\\.error|describe" src package.json',
    terminalCommand: 'terminal "find TODOs and tests"',
    requiredPatterns: ["matches"],
    requiresFullOutput: true,
    minReduction: 0.65,
  },
  {
    id: "logos-source-structure",
    repo: "iapp-logos",
    category: "files",
    weight: 4,
    rawCommand: "find src -maxdepth 2 -type f | sort",
    terminalCommand: 'terminal "show source structure"',
    requiredPatterns: ["files"],
    requiresFullOutput: true,
    minReduction: 0.6,
  },
  {
    id: "logos-typecheck",
    repo: "iapp-logos",
    category: "small",
    weight: 2,
    rawCommand: "bun run typecheck",
    terminalCommand: 'terminal "run typecheck"',
    requiredPatterns: [],
    minReduction: 0,
  },
];

export function defaultRealCliRepoPaths(root = process.cwd()): Record<string, string> {
  return {
    "open-terminal": root,
    "iapp-logos": process.env.IAPP_LOGOS_PATH ?? "/home/hasna/workspace/hasnaxyz/internalapp/iapp-logos",
  };
}

function combined(output: RealCliRunOutput): string {
  return `${output.stdout}${output.stderr}`;
}

function shell(command: string, cwd: string): RealCliRunOutput {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? (result.error ? 1 : 0),
  };
}

function expandHome(path: string): string {
  if (path.startsWith("~/")) return resolve(process.env.HOME ?? "", path.slice(2));
  return path;
}

export function extractFullOutputPath(output: string): string | undefined {
  const match = output.match(/\[full(?: output)?:\s*([^\]]+)\]/);
  return match ? expandHome(match[1].trim()) : undefined;
}

export function extractManifestPath(output: string): string | undefined {
  const match = output.match(/\[manifest:\s*([^\]]+)\]/);
  return match ? expandHome(match[1].trim()) : undefined;
}

function readExpansionTokens(output: string): { path?: string; tokens: number } {
  const manifestPath = extractManifestPath(output);
  if (manifestPath && existsSync(manifestPath)) {
    return { path: manifestPath, tokens: estimateTokens(readFileSync(manifestPath, "utf8")) };
  }
  const path = extractFullOutputPath(output);
  if (!path || !existsSync(path)) return { path, tokens: 0 };
  return { path, tokens: estimateTokens(readFileSync(path, "utf8")) };
}

export function evaluateRealCliWorkflow(
  workflow: RealCliWorkflow,
  raw: RealCliRunOutput,
  terminal: RealCliRunOutput,
): RealCliWorkflowResult {
  const rawText = combined(raw);
  const terminalText = combined(terminal);
  const rawTokens = estimateTokens(rawText);
  const terminalTokens = estimateTokens(terminalText);
  const issues: string[] = [];

  if (raw.status !== 0) issues.push(`raw command exited ${raw.status}`);
  if (terminal.status !== 0) issues.push(`terminal command exited ${terminal.status}`);

  for (const pattern of workflow.requiredPatterns) {
    if (!terminalText.includes(pattern)) issues.push(`missing required pattern: ${pattern}`);
  }

  const forbidden = [
    "cerebras API error",
    "groq API error",
    "request_quota_exceeded",
    "queue_exceeded",
    "No results found",
    ...(workflow.forbiddenPatterns ?? []),
  ];
  for (const pattern of forbidden) {
    if (terminalText.includes(pattern)) issues.push(`forbidden pattern: ${pattern}`);
  }

  const expansion = workflow.requiresFullOutput ? readExpansionTokens(terminalText) : { tokens: 0, path: undefined };
  if (workflow.requiresFullOutput && expansion.tokens === 0) {
    issues.push("missing readable full-output expansion");
  }

  const qualityPassed = issues.length === 0;
  const penaltyTokens = qualityPassed ? 0 : rawTokens;
  const optimizedTokens = terminalTokens + expansion.tokens + penaltyTokens;
  const tokenReduction = rawTokens > 0 ? (rawTokens - optimizedTokens) / rawTokens : 0;
  const tinyOutputFloor = rawTokens <= REAL_CLI_TINY_RAW_TOKEN_THRESHOLD
    && optimizedTokens <= rawTokens + REAL_CLI_TINY_MAX_OVERHEAD_TOKENS;
  const floorPassed = tokenReduction >= workflow.minReduction || (qualityPassed && tinyOutputFloor);

  return {
    ...workflow,
    rawTokens,
    terminalTokens,
    expansionTokens: expansion.tokens,
    penaltyTokens,
    optimizedTokens,
    tokenReduction,
    rawStatus: raw.status,
    terminalStatus: terminal.status,
    fullOutputPath: expansion.path,
    manifestPath: extractManifestPath(terminalText),
    qualityPassed,
    floorPassed,
    tinyOutputFloor,
    issues,
  };
}

export function categoryResults(results: RealCliWorkflowResult[]): RealCliCategoryResult[] {
  const byCategory = new Map<string, RealCliWorkflowResult[]>();
  for (const result of results) byCategory.set(result.category, [...(byCategory.get(result.category) ?? []), result]);
  return [...byCategory.entries()].map(([category, items]) => {
    const weightedRawTokens = items.reduce((sum, item) => sum + item.rawTokens * item.weight, 0);
    const weightedOptimizedTokens = items.reduce((sum, item) => sum + item.optimizedTokens * item.weight, 0);
    const tokenReduction = weightedRawTokens > 0 ? (weightedRawTokens - weightedOptimizedTokens) / weightedRawTokens : 0;
    return {
      category,
      workflows: items.length,
      weightedRawTokens,
      weightedOptimizedTokens,
      tokenReduction,
      floor: REAL_CLI_CATEGORY_FLOOR,
      passed: tokenReduction >= REAL_CLI_CATEGORY_FLOOR,
    };
  }).sort((a, b) => a.category.localeCompare(b.category));
}

function terminalInfo(): { terminalRealPath: string; terminalVersion: string; installedBinaryUsed: boolean } {
  const realPath = shell("readlink -f $(which terminal)", process.cwd()).stdout.trim();
  const version = shell("terminal --version", process.cwd()).stdout.trim();
  return {
    terminalRealPath: realPath,
    terminalVersion: version,
    installedBinaryUsed: realPath.length > 0 && !realPath.includes("/node_modules/.bin/"),
  };
}

export function evaluateRealCliBenchmark(params: {
  terminalBinary?: string;
  terminalRealPath: string;
  terminalVersion: string;
  repos: Record<string, string>;
  workflows: RealCliWorkflowResult[];
  generatedAt?: string;
  installedBinaryUsed?: boolean;
}): RealCliBenchmarkReport {
  const categories = categoryResults(params.workflows);
  const weightedRawTokens = params.workflows.reduce((sum, item) => sum + item.rawTokens * item.weight, 0);
  const weightedOptimizedTokens = params.workflows.reduce((sum, item) => sum + item.optimizedTokens * item.weight, 0);
  const weightedTokenReduction = weightedRawTokens > 0 ? (weightedRawTokens - weightedOptimizedTokens) / weightedRawTokens : 0;
  const qualityFailures = params.workflows.filter((workflow) => !workflow.qualityPassed).length;
  const floorFailures = params.workflows.filter((workflow) => !workflow.floorPassed).length + categories.filter((category) => !category.passed).length;
  const reposCovered = [...new Set(params.workflows.map((workflow) => workflow.repo))].sort();
  const installedBinaryUsed = params.installedBinaryUsed ?? true;

  return {
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    terminalBinary: params.terminalBinary ?? "terminal",
    terminalRealPath: params.terminalRealPath,
    terminalVersion: params.terminalVersion,
    repos: params.repos,
    workflows: params.workflows,
    categories,
    totals: {
      workflowCount: params.workflows.length,
      weightedRawTokens,
      weightedOptimizedTokens,
      weightedNetTokensSaved: weightedRawTokens - weightedOptimizedTokens,
      weightedTokenReduction,
      qualityFailures,
      floorFailures,
      overallTarget: REAL_CLI_OVERALL_TARGET,
      categoryFloor: REAL_CLI_CATEGORY_FLOOR,
      tinyRawTokenThreshold: REAL_CLI_TINY_RAW_TOKEN_THRESHOLD,
      tinyMaxOverheadTokens: REAL_CLI_TINY_MAX_OVERHEAD_TOKENS,
      installedBinaryUsed,
      reposCovered,
      target90Achieved: weightedTokenReduction >= REAL_CLI_OVERALL_TARGET
        && qualityFailures === 0
        && floorFailures === 0
        && installedBinaryUsed
        && reposCovered.includes("open-terminal")
        && reposCovered.includes("iapp-logos"),
    },
  };
}

export function runRealCliBenchmark(options: {
  repoPaths?: Record<string, string>;
  workflows?: RealCliWorkflow[];
} = {}): RealCliBenchmarkReport {
  const repos = { ...defaultRealCliRepoPaths(), ...(options.repoPaths ?? {}) };
  const info = terminalInfo();
  const workflows = options.workflows ?? REAL_CLI_WORKFLOWS;
  const results: RealCliWorkflowResult[] = [];

  for (const workflow of workflows) {
    const cwd = repos[workflow.repo];
    if (!cwd || !existsSync(cwd)) {
      const missing: RealCliRunOutput = { stdout: "", stderr: `repo missing: ${workflow.repo}\n`, status: 1 };
      results.push(evaluateRealCliWorkflow(workflow, missing, missing));
      continue;
    }
    results.push(evaluateRealCliWorkflow(
      workflow,
      shell(workflow.rawCommand, cwd),
      shell(workflow.terminalCommand, cwd),
    ));
  }

  return evaluateRealCliBenchmark({
    terminalRealPath: info.terminalRealPath,
    terminalVersion: info.terminalVersion,
    repos,
    workflows: results,
    installedBinaryUsed: info.installedBinaryUsed,
  });
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatRealCliBenchmarkReport(report: RealCliBenchmarkReport): string {
  const lines = [
    "open-terminal real installed-CLI benchmark",
    `terminal: ${report.terminalVersion} (${report.terminalRealPath})`,
    "",
    "Workflow results:",
    "id                         repo           category     raw  terminal  expand  penalty  optimized  reduction  quality  floor",
    "-------------------------  -------------  -----------  ---  --------  ------  -------  ---------  ---------  -------  -----",
  ];

  for (const result of report.workflows) {
    lines.push([
      result.id.slice(0, 25).padEnd(25),
      result.repo.padEnd(13),
      result.category.padEnd(11),
      String(result.rawTokens).padStart(3),
      String(result.terminalTokens).padStart(8),
      String(result.expansionTokens).padStart(6),
      String(result.penaltyTokens).padStart(7),
      String(result.optimizedTokens).padStart(9),
      pct(result.tokenReduction).padStart(9),
      result.qualityPassed ? "pass".padEnd(7) : "FAIL".padEnd(7),
      result.floorPassed ? "pass" : "FAIL",
    ].join("  "));
    if (result.issues.length > 0) lines.push(`  issues: ${result.issues.join("; ")}`);
  }

  lines.push(
    "",
    "Per-category floors:",
    "category     workflows  raw_weighted  optimized  reduction  floor  status",
    "-----------  ---------  ------------  ---------  ---------  -----  ------",
  );
  for (const category of report.categories) {
    lines.push([
      category.category.padEnd(11),
      String(category.workflows).padStart(9),
      String(Math.round(category.weightedRawTokens)).padStart(12),
      String(Math.round(category.weightedOptimizedTokens)).padStart(9),
      pct(category.tokenReduction).padStart(9),
      pct(category.floor).padStart(5),
      category.passed ? "pass" : "FAIL",
    ].join("  "));
  }

  lines.push(
    "",
    "Totals:",
    `- workflows: ${report.totals.workflowCount}`,
    `- weighted raw tokens: ${Math.round(report.totals.weightedRawTokens).toLocaleString()}`,
    `- weighted optimized tokens: ${Math.round(report.totals.weightedOptimizedTokens).toLocaleString()}`,
    `- weighted token reduction: ${pct(report.totals.weightedTokenReduction)}`,
    `- quality failures: ${report.totals.qualityFailures}`,
    `- floor failures: ${report.totals.floorFailures}`,
    `- tiny-output floor: raw <= ${report.totals.tinyRawTokenThreshold} tokens may pass with <= ${report.totals.tinyMaxOverheadTokens} token overhead; tokens still count in totals`,
    `- repos covered: ${report.totals.reposCovered.join(", ")}`,
    `- installed binary used: ${report.totals.installedBinaryUsed ? "yes" : "NO"}`,
    `- 90% real installed-CLI target: ${report.totals.target90Achieved ? "SUPPORTED" : "NOT SUPPORTED"}`,
  );

  return lines.join("\n");
}

export function toRealCliGateEvidence(report: RealCliBenchmarkReport): RealCliGateEvidence {
  return {
    target90Achieved: report.totals.target90Achieved,
    weightedTokenReduction: report.totals.weightedTokenReduction,
    qualityFailures: report.totals.qualityFailures,
    floorFailures: report.totals.floorFailures,
    installedBinaryUsed: report.totals.installedBinaryUsed,
    reposCovered: report.totals.reposCovered,
    workflowCount: report.totals.workflowCount,
  };
}
