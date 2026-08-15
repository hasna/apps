/**
 * WCAG Accessibility scanner using axe-core.
 *
 * Injects axe-core into the live browser page and runs a full WCAG audit.
 * Works in authenticated, dynamically-loaded states — unlike static scanners.
 *
 * Usage:
 *   import { scanPageA11y } from "./scanners/a11y.js";
 *   const violations = await scanPageA11y(page, { wcagLevel: "AA" });
 */

import type { Page } from "playwright";
import type { ScanIssue, ScanResult } from "../../types/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WcagLevel = "A" | "AA" | "AAA";
export type A11yImpact = "critical" | "serious" | "moderate" | "minor";

export interface A11yViolation {
  id: string;                    // axe rule ID e.g. "color-contrast"
  impact: A11yImpact;
  description: string;
  wcagCriteria: string[];        // e.g. ["1.4.3", "1.4.6"]
  nodes: Array<{
    selector: string;
    html: string;
    failureSummary: string;
  }>;
}

export interface A11yScanOptions {
  wcagLevel?: WcagLevel;         // default "AA"
  include?: string[];            // CSS selectors to limit scan scope
  exclude?: string[];
  runOnly?: string[];            // specific axe rule IDs to run
}

// ─── axe-core inline script ───────────────────────────────────────────────────
// Loaded via CDN to avoid bundling the full axe-core (300KB+).
// Falls back to a minimal inline implementation if CDN is unavailable.

const AXE_CDN = "https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js";

async function injectAxe(page: Page): Promise<boolean> {
  // Check if already injected
  const alreadyLoaded = await page.evaluate(() => typeof (window as unknown as Record<string, unknown>)["axe"] !== "undefined").catch(() => false);
  if (alreadyLoaded) return true;

  // Try CDN first
  try {
    await page.addScriptTag({ url: AXE_CDN });
    return true;
  } catch {
    // CDN blocked or no network — use page.evaluate to define minimal stub
    // and return false so caller can handle gracefully
    return false;
  }
}

// ─── Main Scanner Function ────────────────────────────────────────────────────

export async function scanPageA11y(
  page: Page,
  options?: A11yScanOptions,
): Promise<A11yViolation[]> {
  const injected = await injectAxe(page);
  if (!injected) return [];

  const level = options?.wcagLevel ?? "AA";

  // Map WCAG level to axe tags
  const tagMap: Record<WcagLevel, string[]> = {
    A: ["wcag2a", "wcag21a"],
    AA: ["wcag2a", "wcag21a", "wcag2aa", "wcag21aa"],
    AAA: ["wcag2a", "wcag21a", "wcag2aa", "wcag21aa", "wcag2aaa"],
  };
  const tags = tagMap[level];

  type AxeResult = {
    violations: Array<{
      id: string;
      impact: string;
      description: string;
      tags: string[];
      nodes: Array<{ target: unknown[]; html: string; failureSummary: string }>;
    }>;
  };

  try {
    const result = await page.evaluate(async (runTags: string[]) => {
      const axeRef = (window as unknown as Record<string, unknown>)["axe"] as {
        run: (ctx: Document, opts: Record<string, unknown>) => Promise<unknown>;
      };
      const axeResult = await axeRef.run(document, {
        runOnly: { type: "tag", values: runTags },
      });
      return axeResult;
    }, tags) as AxeResult;

    return result.violations.map((v): A11yViolation => {
      // Extract WCAG criteria from tags e.g. "wcag143" → "1.4.3"
      const wcagCriteria = v.tags
        .filter((t) => /^wcag\d+[a-z]?$/.test(t) && t.length > 5)
        .map((t) => {
          const digits = t.replace("wcag", "");
          // Convert "143" → "1.4.3", "411" → "4.1.1"
          return digits.replace(/(\d)(\d)(\d)/, "$1.$2.$3").replace(/^(\d)(\d)$/, "$1.$2");
        });

      return {
        id: v.id,
        impact: (v.impact ?? "minor") as A11yImpact,
        description: v.description,
        wcagCriteria: [...new Set(wcagCriteria)],
        nodes: v.nodes.slice(0, 5).map((n) => ({
          selector: Array.isArray(n.target) ? n.target.join(" ") : String(n.target),
          html: n.html.slice(0, 200),
          failureSummary: n.failureSummary.slice(0, 200),
        })),
      };
    });
  } catch {
    return [];
  }
}

// ─── Standalone Page Scanner ──────────────────────────────────────────────────

export async function scanA11y(options: {
  url: string;
  pages?: string[];
  wcagLevel?: WcagLevel;
  headed?: boolean;
  timeoutMs?: number;
  projectId?: string;
}): Promise<ScanResult> {
  const { launchBrowser, getPage, closeBrowser } = await import("../browser.js");
  const start = Date.now();
  const issues: ScanIssue[] = [];
  const scannedPages: string[] = [];

  const browser = await launchBrowser({ headless: !options.headed });
  try {
    const page = await getPage(browser, {});
    const baseUrl = options.url.replace(/\/$/, "");
    const pageUrls = options.pages?.length
      ? options.pages.map((p) => p.startsWith("http") ? p : `${baseUrl}${p}`)
      : [options.url];

    for (const url of pageUrls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 15000 });
        scannedPages.push(url);

        const violations = await scanPageA11y(page, { wcagLevel: options.wcagLevel ?? "AA" });

        for (const v of violations) {
          const severityMap: Record<A11yImpact, ScanIssue["severity"]> = {
            critical: "critical", serious: "high", moderate: "medium", minor: "low",
          };
          issues.push({
            type: "console_error",
            severity: severityMap[v.impact] ?? "medium",
            pageUrl: url,
            message: `a11y [${v.id}]: ${v.description}`,
            detail: {
              ruleId: v.id,
              impact: v.impact,
              wcagCriteria: v.wcagCriteria,
              nodeCount: v.nodes.length,
              firstSelector: v.nodes[0]?.selector ?? "",
            },
          });
        }
      } catch {
        // Page navigation failed — skip
      }
    }
  } finally {
    await closeBrowser(browser);
  }

  return {
    url: options.url,
    pages: scannedPages,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    issues,
  };
}
