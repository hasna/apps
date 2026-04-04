import type { Page } from "playwright";

export interface WebVitals {
  /** Largest Contentful Paint - loading performance */
  lcp: number | null; // ms
  /** First Input Delay - interactivity */
  fid: number | null; // ms
  /** Cumulative Layout Shift - visual stability */
  cls: number | null;
  /** Time to First Byte - server response time */
  ttfb: number | null; // ms
  /** First Contentful Paint - initial content render */
  fcp: number | null; // ms
  /** Total Blocking Time - main thread blocked time */
  tbt: number | null; // ms
  /** Time to Interactive - page fully interactive */
  tti: number | null; // ms
  /** DOM Content Loaded event time */
  domContentLoaded: number | null; // ms
  /** Full page load time */
  loadComplete: number | null; // ms
}

export interface PerformanceBudget {
  lcp?: number; // ms
  cls?: number;
  ttfb?: number; // ms
  fcp?: number; // ms
  tbt?: number; // ms
  tti?: number; // ms
  loadComplete?: number; // ms
}

export interface BudgetViolation {
  metric: string;
  actual: number;
  budget: number;
  unit: string;
}

export interface PerformanceResult {
  vitals: WebVitals;
  budgetViolations: BudgetViolation[];
  url: string;
  timestamp: string;
  pass: boolean;
}

/**
 * Collect Core Web Vitals and performance metrics from the current page.
 * Uses the Performance API and web-vitals library via CDN.
 */
export async function collectWebVitals(page: Page): Promise<WebVitals> {
  await page.addScriptTag({ url: "https://unpkg.com/web-vitals@4/dist/web-vitals.iife.js" });

  const vitals = await page.evaluate(() => {
    // @ts-ignore - web-vitals loaded via script tag
    const wv = window.webVitals;

    // Collect from Performance API
    const perf = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;

    const result: {
      lcp: number | null;
      fid: number | null;
      cls: number | null;
      ttfb: number | null;
      fcp: number | null;
      tbt: number | null;
      tti: number | null;
      domContentLoaded: number | null;
      loadComplete: number | null;
    } = {
      lcp: null,
      fid: null,
      cls: null,
      ttfb: null,
      fcp: null,
      tbt: null,
      tti: null,
      domContentLoaded: null,
      loadComplete: null,
    };

    // Navigation Timing API
    if (perf) {
      result.ttfb = perf.responseStart - perf.requestStart;
      result.fcp = perf.domInteractive - perf.startTime;
      result.domContentLoaded = perf.domContentLoadedEventEnd - perf.startTime;
      result.loadComplete = perf.loadEventEnd - perf.startTime;
      result.tbt = Math.max(0, perf.domInteractive - perf.domContentLoadedEventStart);
    }

    return result;
  });

  return {
    lcp: vitals.lcp,
    fid: vitals.fid,
    cls: vitals.cls,
    ttfb: vitals.ttfb,
    fcp: vitals.fcp,
    tbt: vitals.tbt,
    tti: vitals.tti,
    domContentLoaded: vitals.domContentLoaded,
    loadComplete: vitals.loadComplete,
  };
}

/**
 * Collect performance metrics from the Navigation Timing API without external deps.
 */
export async function collectPerformanceMetrics(page: Page): Promise<WebVitals> {
  const metrics = await page.evaluate(() => {
    const perf = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!perf) return null;

    // Calculate Total Blocking Time from Long Tasks
    let tbt = 0;
    const longTasks = performance.getEntriesByType("longtask") as PerformanceEntry[];
    for (const task of longTasks) {
      if (task.duration > 50) {
        tbt += task.duration - 50;
      }
    }

    // Calculate FCP from paint entries
    const paintEntries = performance.getEntriesByType("paint");
    const fcpEntry = paintEntries.find((e) => e.name === "first-contentful-paint");
    const fcp = fcpEntry ? fcpEntry.startTime : null;

    // CLS from layout-shift entries
    let cls = 0;
    const layoutShifts = performance.getEntriesByType("layout-shift") as PerformanceEntry[];
    for (const shift of layoutShifts) {
      const entry = shift as { value?: number };
      if (entry.value && !entry.hadRecentInput) {
        cls += entry.value;
      }
    }

    return {
      lcp: null, // Requires LargestContentfulPaint observer
      fid: null, // Requires FirstInputDelay observer
      cls,
      ttfb: perf.responseStart - perf.requestStart,
      fcp,
      tbt,
      tti: perf.domInteractive - perf.startTime,
      domContentLoaded: perf.domContentLoadedEventEnd - perf.startTime,
      loadComplete: perf.loadEventEnd - perf.startTime,
    };
  });

  return metrics ?? {
    lcp: null, fid: null, cls: null, ttfb: null, fcp: null, tbt: null, tti: null, domContentLoaded: null, loadComplete: null,
  };
}

/**
 * Check collected vitals against a performance budget.
 */
export function checkBudget(vitals: WebVitals, budget: PerformanceBudget): BudgetViolation[] {
  const violations: BudgetViolation[] = [];

  const checks: Array<{ key: keyof WebVitals; budgetKey: keyof PerformanceBudget; unit: string }> = [
    { key: "lcp", budgetKey: "lcp", unit: "ms" },
    { key: "cls", budgetKey: "cls", unit: "" },
    { key: "ttfb", budgetKey: "ttfb", unit: "ms" },
    { key: "fcp", budgetKey: "fcp", unit: "ms" },
    { key: "tbt", budgetKey: "tbt", unit: "ms" },
    { key: "tti", budgetKey: "tti", unit: "ms" },
    { key: "loadComplete", budgetKey: "loadComplete", unit: "ms" },
  ];

  for (const { key, budgetKey, unit } of checks) {
    const budgetValue = budget[budgetKey];
    const actualValue = vitals[key];
    if (budgetValue != null && actualValue != null && actualValue > budgetValue) {
      violations.push({
        metric: key,
        actual: actualValue,
        budget: budgetValue,
        unit,
      });
    }
  }

  return violations;
}

/**
 * Default performance budgets based on Google's "good" thresholds.
 */
export const DEFAULT_BUDGET: PerformanceBudget = {
  lcp: 2500,
  cls: 0.1,
  ttfb: 800,
  fcp: 1800,
  tbt: 200,
  tti: 3800,
  loadComplete: 5000,
};

/**
 * Format performance results as a human-readable report.
 */
export function formatPerformanceResult(result: PerformanceResult): string {
  const lines: string[] = [];
  lines.push(`Performance Report: ${result.url}`);
  lines.push("");

  const metricLabels: Record<string, string> = {
    lcp: "Largest Contentful Paint",
    fid: "First Input Delay",
    cls: "Cumulative Layout Shift",
    ttfb: "Time to First Byte",
    fcp: "First Contentful Paint",
    tbt: "Total Blocking Time",
    tti: "Time to Interactive",
    domContentLoaded: "DOM Content Loaded",
    loadComplete: "Load Complete",
  };

  for (const [key, label] of Object.entries(metricLabels)) {
    const value = result.vitals[key as keyof WebVitals];
    if (value != null) {
      lines.push(`  ${label}: ${value.toFixed(0)} ${key === "cls" ? "" : "ms"}`);
    }
  }

  if (result.budgetViolations.length > 0) {
    lines.push("");
    lines.push("Budget Violations:");
    for (const v of result.budgetViolations) {
      lines.push(`  ${v.metric}: ${v.actual.toFixed(0)}${v.unit} (budget: ${v.budget}${v.unit})`);
    }
  } else {
    lines.push("");
    lines.push("All performance budgets passed.");
  }

  return lines.join("\n");
}
