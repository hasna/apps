import { createScenario, deleteScenario } from "../db/scenarios.js";
import { runSingleScenario } from "./runner.js";
import type { Run, Result } from "../types/index.js";
import { createRun, updateRun } from "../db/runs.js";
import { loadConfig } from "./config.js";
import { resolveModel } from "./ai-client.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SmokeResult {
  run: Run;
  result: Result;
  pagesVisited: number;
  issuesFound: SmokeIssue[];
}

export interface SmokeIssue {
  type: "js-error" | "404" | "broken-image" | "broken-link" | "visual" | "performance";
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  url: string;
  screenshot?: string;
}

// ─── Smoke Test Runner ──────────────────────────────────────────────────────

const SMOKE_DESCRIPTION = `You are performing an autonomous smoke test of this web application. Your job is to explore as many pages as possible and find issues. Follow these instructions:

1. Start at the given URL and take a screenshot
2. Find all visible navigation links and click through each one
3. On each page: check for visible error messages, broken layouts, missing images
4. Use get_page_html to check for error indicators in the HTML
5. Try clicking the main interactive elements (buttons, links, forms)
6. Keep track of every page you visit
7. After exploring at least 5 different pages (or all available pages), report your findings

In your report_result, include:
- Total pages visited
- Any JavaScript errors you noticed
- Any broken links (pages that show 404 or error)
- Any visual issues (broken layouts, missing images, overlapping text)
- Any forms that don't work
- Rate each issue as critical/high/medium/low severity`;

export async function runSmoke(options: {
  url: string;
  model?: string;
  headed?: boolean;
  timeout?: number;
  projectId?: string;
  apiKey?: string;
}): Promise<SmokeResult> {
  const config = loadConfig();
  const model = resolveModel(options.model ?? config.defaultModel);

  // 1. Create a temporary scenario
  const scenario = createScenario({
    name: "Smoke Test",
    description: SMOKE_DESCRIPTION,
    tags: ["smoke", "auto"],
    priority: "high",
    projectId: options.projectId,
  });

  // 2. Create a run record
  const run = createRun({
    url: options.url,
    model,
    headed: options.headed,
    parallel: 1,
    projectId: options.projectId,
  });

  updateRun(run.id, { status: "running", total: 1 });

  let result: Result;
  try {
    // 3. Run the scenario
    result = await runSingleScenario(scenario, run.id, {
      url: options.url,
      model: options.model,
      headed: options.headed,
      timeout: options.timeout,
      projectId: options.projectId,
      apiKey: options.apiKey,
    });

    // 4. Finalize run
    const finalStatus = result.status === "passed" ? "passed" : "failed";
    updateRun(run.id, {
      status: finalStatus,
      passed: result.status === "passed" ? 1 : 0,
      failed: result.status === "passed" ? 0 : 1,
      total: 1,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    updateRun(run.id, {
      status: "failed",
      failed: 1,
      total: 1,
      finished_at: new Date().toISOString(),
    });
    throw error;
  } finally {
    // 5. Cleanup: delete the temporary scenario
    deleteScenario(scenario.id);
  }

  // 6. Parse issues from the AI's reasoning
  const issues = parseSmokeIssues(result.reasoning ?? "");
  const pagesVisited = extractPagesVisited(result.reasoning ?? "");

  // Fetch the final run state
  const { getRun } = await import("../db/runs.js");
  const finalRun = getRun(run.id)!;

  return {
    run: finalRun,
    result,
    pagesVisited,
    issuesFound: issues,
  };
}

// ─── Issue Parsing ──────────────────────────────────────────────────────────

const SEVERITY_PATTERN = /\b(CRITICAL|HIGH|MEDIUM|LOW)\b[:\s-]*(.+)/gi;
const PAGES_VISITED_PATTERN = /(\d+)\s*(?:pages?\s*visited|pages?\s*explored|pages?\s*checked|total\s*pages?)/i;
const URL_PATTERN = /https?:\/\/[^\s,)]+/g;

const ISSUE_TYPE_MAP: Record<string, SmokeIssue["type"]> = {
  "javascript": "js-error",
  "js error": "js-error",
  "js-error": "js-error",
  "console error": "js-error",
  "404": "404",
  "not found": "404",
  "broken link": "broken-link",
  "dead link": "broken-link",
  "broken image": "broken-image",
  "missing image": "broken-image",
  "visual": "visual",
  "layout": "visual",
  "overlap": "visual",
  "broken layout": "visual",
  "performance": "performance",
  "slow": "performance",
};

function inferIssueType(text: string): SmokeIssue["type"] {
  const lower = text.toLowerCase();
  for (const [keyword, type] of Object.entries(ISSUE_TYPE_MAP)) {
    if (lower.includes(keyword)) return type;
  }
  return "visual"; // default fallback
}

function extractUrl(text: string, fallback: string = ""): string {
  const match = text.match(URL_PATTERN);
  return match ? match[0] : fallback;
}

export function parseSmokeIssues(reasoning: string): SmokeIssue[] {
  const issues: SmokeIssue[] = [];
  const seen = new Set<string>();

  // Strategy 1: Look for severity-prefixed lines (CRITICAL: ..., HIGH: ...)
  let match: RegExpExecArray | null;
  const severityRegex = new RegExp(SEVERITY_PATTERN.source, "gi");
  while ((match = severityRegex.exec(reasoning)) !== null) {
    const severity = match[1]!.toLowerCase() as SmokeIssue["severity"];
    const description = match[2]!.trim();
    const key = `${severity}:${description.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    issues.push({
      type: inferIssueType(description),
      severity,
      description,
      url: extractUrl(description),
    });
  }

  // Strategy 2: Look for bullet-pointed issues with severity indicators
  const bulletLines = reasoning.split("\n").filter((line) =>
    /^\s*[-*]\s/.test(line) && /\b(error|broken|missing|404|fail|issue|bug|problem)\b/i.test(line)
  );

  for (const line of bulletLines) {
    const cleaned = line.replace(/^\s*[-*]\s*/, "").trim();
    const key = `bullet:${cleaned.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Try to extract severity from the line
    let severity: SmokeIssue["severity"] = "medium";
    if (/\bcritical\b/i.test(cleaned)) severity = "critical";
    else if (/\bhigh\b/i.test(cleaned)) severity = "high";
    else if (/\blow\b/i.test(cleaned)) severity = "low";
    else if (/\b(error|fail|broken|crash)\b/i.test(cleaned)) severity = "high";

    issues.push({
      type: inferIssueType(cleaned),
      severity,
      description: cleaned,
      url: extractUrl(cleaned),
    });
  }

  return issues;
}

function extractPagesVisited(reasoning: string): number {
  const match = reasoning.match(PAGES_VISITED_PATTERN);
  if (match) return parseInt(match[1]!, 10);

  // Fallback: count distinct URLs mentioned
  const urls = reasoning.match(URL_PATTERN);
  if (urls) {
    const unique = new Set(urls.map((u) => new URL(u).pathname));
    return unique.size;
  }

  return 0;
}

// ─── Report Formatting ──────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<SmokeIssue["severity"], (text: string) => string> = {
  critical: (t) => `\x1b[41m\x1b[37m ${t} \x1b[0m`, // white on red bg
  high: (t) => `\x1b[31m${t}\x1b[0m`,                 // red
  medium: (t) => `\x1b[33m${t}\x1b[0m`,               // yellow
  low: (t) => `\x1b[36m${t}\x1b[0m`,                   // cyan
};

const SEVERITY_ORDER: SmokeIssue["severity"][] = ["critical", "high", "medium", "low"];

export function formatSmokeReport(result: SmokeResult): string {
  const lines: string[] = [];
  const url = result.run.url;

  // Header
  lines.push("");
  lines.push(`\x1b[1m  Smoke Test Report \x1b[2m- ${url}\x1b[0m`);
  lines.push(`  ${"─".repeat(60)}`);

  // Summary
  const issueCount = result.issuesFound.length;
  const criticalCount = result.issuesFound.filter((i) => i.severity === "critical").length;
  const highCount = result.issuesFound.filter((i) => i.severity === "high").length;

  lines.push("");
  lines.push(`  Pages visited:  \x1b[1m${result.pagesVisited}\x1b[0m`);
  lines.push(`  Issues found:   \x1b[1m${issueCount}\x1b[0m`);
  lines.push(`  Duration:       ${result.result.durationMs ? `${(result.result.durationMs / 1000).toFixed(1)}s` : "N/A"}`);
  lines.push(`  Model:          ${result.run.model}`);
  lines.push(`  Tokens used:    ${result.result.tokensUsed}`);

  // Issues by severity
  if (issueCount > 0) {
    lines.push("");
    lines.push(`\x1b[1m  Issues\x1b[0m`);
    lines.push("");

    for (const severity of SEVERITY_ORDER) {
      const group = result.issuesFound.filter((i) => i.severity === severity);
      if (group.length === 0) continue;

      const badge = SEVERITY_COLORS[severity](severity.toUpperCase());
      lines.push(`  ${badge}`);

      for (const issue of group) {
        const urlSuffix = issue.url ? ` \x1b[2m(${issue.url})\x1b[0m` : "";
        lines.push(`    - ${issue.description}${urlSuffix}`);
      }
      lines.push("");
    }
  }

  // Verdict
  lines.push(`  ${"─".repeat(60)}`);
  const hasCritical = criticalCount > 0 || highCount > 0;
  if (hasCritical) {
    lines.push(`  Verdict: \x1b[31m\x1b[1mFAIL\x1b[0m \x1b[2m(${criticalCount} critical, ${highCount} high severity issues)\x1b[0m`);
  } else if (issueCount > 0) {
    lines.push(`  Verdict: \x1b[33m\x1b[1mWARN\x1b[0m \x1b[2m(${issueCount} issues found, none critical/high)\x1b[0m`);
  } else {
    lines.push(`  Verdict: \x1b[32m\x1b[1mPASS\x1b[0m \x1b[2m(no issues found)\x1b[0m`);
  }
  lines.push("");

  return lines.join("\n");
}
