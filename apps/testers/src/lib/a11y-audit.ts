import type { Page } from "playwright";

export type A11yLevel = "A" | "AA" | "AAA";

export interface A11yViolation {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  help: string;
  helpUrl: string;
  nodes: {
    html: string;
    target: string[];
    failureSummary?: string;
  }[];
}

export interface A11yAuditResult {
  violations: A11yViolation[];
  passes: { id: string; description: string }[];
  incomplete: { id: string; description: string; impact?: string }[];
  url: string;
  timestamp: string;
  totalViolations: number;
  criticalCount: number;
  seriousCount: number;
  moderateCount: number;
  minorCount: number;
}

export interface A11yAuditOptions {
  level?: A11yLevel;
  /** Specific rules to run (by default, runs all) */
  rules?: string[];
  /** Elements to exclude from scanning */
  exclude?: string[];
}

/**
 * Run axe-core accessibility audit on the current page.
 * Injects axe via CDN and runs accessibility checks.
 */
export async function runA11yAudit(
  page: Page,
  options: A11yAuditOptions = {},
): Promise<A11yAuditResult> {
  const { level = "AA", rules, exclude = [] } = options;

  // Inject axe-core
  await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js" });

  // Build audit config
  const config: Record<string, unknown> = {
    runOnly: {
      type: level === "AAA" ? "standard" : "tag",
      values: level === "AAA" ? undefined : [level, "best-practice"],
    },
  };

  if (rules && rules.length > 0) {
    config.rules = Object.fromEntries(rules.map((r) => [r, { enabled: true }]));
  }

  if (exclude.length > 0) {
    config.exclude = exclude;
  }

  const result = await page.evaluate(async (auditConfig) => {
    // @ts-ignore - axe is loaded via script tag
    const axeResult = await window.axe.run(auditConfig);
    return axeResult;
  }, config);

  const violations: A11yViolation[] = (result.violations ?? []).map((v: Record<string, unknown>) => ({
    id: v.id as string,
    impact: v.impact as A11yViolation["impact"],
    description: v.description as string,
    help: v.help as string,
    helpUrl: v.helpUrl as string,
    nodes: (v.nodes ?? []).map((n: Record<string, unknown>) => ({
      html: n.html as string,
      target: n.target as string[],
      failureSummary: n.failureSummary as string | undefined,
    })),
  }));

  const passes = (result.passes ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    description: p.description as string,
  }));

  const incomplete = (result.incomplete ?? []).map((i: Record<string, unknown>) => ({
    id: i.id as string,
    description: i.description as string,
    impact: i.impact as string | undefined,
  }));

  const criticalCount = violations.filter((v) => v.impact === "critical").length;
  const seriousCount = violations.filter((v) => v.impact === "serious").length;
  const moderateCount = violations.filter((v) => v.impact === "moderate").length;
  const minorCount = violations.filter((v) => v.impact === "minor").length;

  return {
    violations,
    passes,
    incomplete,
    url: page.url(),
    timestamp: new Date().toISOString(),
    totalViolations: violations.length,
    criticalCount,
    seriousCount,
    moderateCount,
    minorCount,
  };
}

/**
 * Check if any violations exceed the given severity threshold.
 */
export function hasA11yIssues(result: A11yAuditResult, maxImpact: A11yViolation["impact"] = "minor"): boolean {
  const severityOrder: Record<A11yViolation["impact"], number> = {
    critical: 4,
    serious: 3,
    moderate: 2,
    minor: 1,
  };

  const threshold = severityOrder[maxImpact];
  return result.violations.some((v) => severityOrder[v.impact] >= threshold);
}

/**
 * Format accessibility audit results as a human-readable report.
 */
export function formatA11yResults(result: A11yAuditResult): string {
  const lines: string[] = [];
  lines.push(`A11y Audit: ${result.totalViolations} violation(s) on ${result.url}`);
  lines.push(`  Critical: ${result.criticalCount}, Serious: ${result.seriousCount}, Moderate: ${result.moderateCount}, Minor: ${result.minorCount}`);
  lines.push(`  Passed checks: ${result.passes.length}`);
  lines.push(`  Incomplete checks: ${result.incomplete.length}`);
  lines.push("");

  if (result.violations.length > 0) {
    lines.push("VIOLATIONS:");
    for (const v of result.violations) {
      lines.push(`  [${v.impact.toUpperCase()}] ${v.id}: ${v.description}`);
      lines.push(`    Help: ${v.help}`);
      lines.push(`    Affected elements: ${v.nodes.length}`);
      for (const node of v.nodes.slice(0, 3)) {
        if (node.failureSummary) {
          lines.push(`      - ${node.failureSummary}`);
        }
      }
    }
  }

  if (result.incomplete.length > 0) {
    lines.push("\nINCOMPLETE CHECKS (manual review needed):");
    for (const i of result.incomplete) {
      lines.push(`  ${i.id}: ${i.description}`);
    }
  }

  return lines.join("\n");
}
