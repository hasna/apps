import { launchBrowser, getPage, closeBrowser } from "../browser.js";
import type { ScanIssue, ScanResult } from "../../types/index.js";

interface NetworkEntry {
  url: string;
  status: number;
  method: string;
  type: string;
  failed: boolean;
  failureText?: string;
}

/**
 * Visit each page and intercept network requests, flagging:
 * - HTTP 5xx (server errors)
 * - HTTP 4xx on API routes
 * - CORS errors
 * - Request failures (net::ERR_*)
 */
export async function scanNetworkErrors(options: {
  url: string;
  pages?: string[];
  headed?: boolean;
  timeoutMs?: number;
}): Promise<ScanResult> {
  const { url, pages, headed = false, timeoutMs = 15000 } = options;
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
      const entries: NetworkEntry[] = [];

      page.on("response", (resp) => {
        const reqUrl = resp.url();
        const status = resp.status();
        if (shouldIgnoreUrl(reqUrl)) return;
        if (status >= 400) {
          entries.push({ url: reqUrl, status, method: resp.request().method(), type: resp.request().resourceType(), failed: false });
        }
      });

      page.on("requestfailed", (req) => {
        const reqUrl = req.url();
        if (shouldIgnoreUrl(reqUrl)) return;
        entries.push({
          url: reqUrl,
          status: 0,
          method: req.method(),
          type: req.resourceType(),
          failed: true,
          failureText: req.failure()?.errorText,
        });
      });

      try {
        await page.goto(pageUrl, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1000);
        scannedPages.push(pageUrl);
      } catch {
        scannedPages.push(pageUrl);
      } finally {
        await page.close();
      }

      for (const entry of entries) {
        const severity = classifyNetworkSeverity(entry);
        const message = entry.failed
          ? `Request failed: ${entry.method} ${entry.url} — ${entry.failureText ?? "unknown"}`
          : `HTTP ${entry.status}: ${entry.method} ${entry.url}`;

        issues.push({
          type: "network_error",
          severity,
          pageUrl,
          message: message.slice(0, 500),
          detail: {
            requestUrl: entry.url,
            status: entry.status,
            method: entry.method,
            resourceType: entry.type,
            failureText: entry.failureText ?? null,
          },
        });
      }
    }
  } finally {
    await closeBrowser(browser);
  }

  return { url, pages: scannedPages, scannedAt: new Date().toISOString(), durationMs: Date.now() - start, issues };
}

const IGNORE_URL_PATTERNS = [
  /favicon\.ico/i,
  /\.woff2?$/i,
  /fonts\.googleapis\.com/i,
  /analytics\.(google|segment)/i,
  /hotjar\.com/i,
  /sentry\.io/i,
];

function shouldIgnoreUrl(reqUrl: string): boolean {
  return IGNORE_URL_PATTERNS.some((p) => p.test(reqUrl));
}

function classifyNetworkSeverity(entry: NetworkEntry): ScanIssue["severity"] {
  if (entry.failed) {
    if (entry.failureText?.includes("CORS") || entry.failureText?.includes("blocked")) return "critical";
    return "high";
  }
  if (entry.status >= 500) return "critical";
  if (entry.status === 401 || entry.status === 403) return "high";
  if (entry.status >= 400) return "medium";
  return "low";
}
