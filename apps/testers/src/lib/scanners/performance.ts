import { launchBrowser, getPage, closeBrowser } from "../browser.js";
import type { ScanIssue, ScanResult } from "../../types/index.js";

interface PerfMetrics {
  pageUrl: string;
  loadTimeMs: number;
  domContentLoadedMs: number;
  firstPaintMs: number | null;
  lcpMs: number | null;
  requestCount: number;
  transferBytes: number;
}

interface PerfThresholds {
  loadTimeMs: number;        // default 5000
  domContentLoadedMs: number; // default 3000
  lcpMs: number;             // default 2500
}

const DEFAULT_THRESHOLDS: PerfThresholds = {
  loadTimeMs: 5000,
  domContentLoadedMs: 3000,
  lcpMs: 2500,
};

/**
 * Visit each page and collect Web Performance API metrics.
 * Flags pages that exceed configurable thresholds.
 */
export async function scanPerformance(options: {
  url: string;
  pages?: string[];
  headed?: boolean;
  timeoutMs?: number;
  thresholds?: Partial<PerfThresholds>;
}): Promise<ScanResult> {
  const { url, pages, headed = false, timeoutMs = 20000, thresholds: customThresholds } = options;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...customThresholds };
  const start = Date.now();
  const scannedPages: string[] = [];
  const issues: ScanIssue[] = [];

  const pageUrls = pages?.length
    ? pages.map((p) => (p.startsWith("http") ? p : `${url.replace(/\/$/, "")}${p}`))
    : [url];

  const browser = await launchBrowser({ headless: !headed });
  try {
    for (const pageUrl of pageUrls) {
      const page = await getPage(browser, {});
      let transferBytes = 0;
      let requestCount = 0;

      page.on("response", async (resp) => {
        requestCount++;
        try {
          const headers = resp.headers();
          const contentLength = parseInt(headers["content-length"] ?? "0", 10);
          if (!isNaN(contentLength)) transferBytes += contentLength;
        } catch { /* ignore */ }
      });

      try {
        await page.goto(pageUrl, { timeout: timeoutMs, waitUntil: "load" });
        scannedPages.push(pageUrl);

        const metrics: PerfMetrics = await page.evaluate((pUrl) => {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          const paintEntries = performance.getEntriesByType("paint");
          const fpEntry = paintEntries.find((e) => e.name === "first-paint");
          const fcpEntry = paintEntries.find((e) => e.name === "first-contentful-paint");

          // LCP via PerformanceObserver snapshot
          let lcpMs: number | null = null;
          try {
            const lcpEntries = performance.getEntriesByType("largest-contentful-paint") as PerformanceEntry[];
            if (lcpEntries.length > 0) {
              lcpMs = lcpEntries[lcpEntries.length - 1]!.startTime;
            }
          } catch { /* LCP not available */ }

          return {
            pageUrl: pUrl,
            loadTimeMs: nav ? Math.round(nav.loadEventEnd - nav.startTime) : 0,
            domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : 0,
            firstPaintMs: fpEntry ? Math.round(fpEntry.startTime) : (fcpEntry ? Math.round(fcpEntry.startTime) : null),
            lcpMs,
            requestCount: 0, // filled below
            transferBytes: 0, // filled below
          };
        }, pageUrl);

        metrics.requestCount = requestCount;
        metrics.transferBytes = transferBytes;

        // Evaluate against thresholds
        if (metrics.loadTimeMs > thresholds.loadTimeMs) {
          issues.push({
            type: "performance",
            severity: metrics.loadTimeMs > thresholds.loadTimeMs * 2 ? "critical" : "high",
            pageUrl,
            message: `Slow page load: ${metrics.loadTimeMs}ms (threshold: ${thresholds.loadTimeMs}ms)`,
            detail: { ...metrics },
          });
        }

        if (metrics.domContentLoadedMs > thresholds.domContentLoadedMs) {
          issues.push({
            type: "performance",
            severity: "medium",
            pageUrl,
            message: `Slow DOMContentLoaded: ${metrics.domContentLoadedMs}ms (threshold: ${thresholds.domContentLoadedMs}ms)`,
            detail: { ...metrics },
          });
        }

        if (metrics.lcpMs !== null && metrics.lcpMs > thresholds.lcpMs) {
          issues.push({
            type: "performance",
            severity: metrics.lcpMs > thresholds.lcpMs * 2 ? "critical" : "high",
            pageUrl,
            message: `Poor LCP: ${Math.round(metrics.lcpMs)}ms (threshold: ${thresholds.lcpMs}ms)`,
            detail: { ...metrics },
          });
        }
      } catch (err) {
        issues.push({
          type: "performance",
          severity: "medium",
          pageUrl,
          message: `Performance scan failed: ${err instanceof Error ? err.message : String(err)}`,
          detail: {},
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await closeBrowser(browser);
  }

  return { url, pages: scannedPages, scannedAt: new Date().toISOString(), durationMs: Date.now() - start, issues };
}
