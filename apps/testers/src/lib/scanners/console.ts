import { launchBrowser, getPage, closeBrowser } from "../browser.js";
import type { ScanIssue, ScanResult } from "../../types/index.js";

interface ConsoleEntry {
  type: string;
  text: string;
  location?: string;
}

/**
 * Visit each page and collect JS/React/unhandled errors from the browser console.
 * Captures: console.error(), uncaught exceptions, unhandled promise rejections.
 */
export async function scanConsoleErrors(options: {
  url: string;
  pages?: string[];
  headed?: boolean;
  timeoutMs?: number;
}): Promise<ScanResult> {
  const { url, pages, headed = false, timeoutMs = 15000 } = options;
  const start = Date.now();
  const scannedPages: string[] = [];
  const issues: ScanIssue[] = [];

  // Normalise page list
  const pageUrls = pages?.length
    ? pages.map((p) => (p.startsWith("http") ? p : `${url.replace(/\/$/, "")}${p}`))
    : [url];

  const browser = await launchBrowser({ headless: !headed });
  try {
    for (const pageUrl of pageUrls) {
      const page = await getPage(browser, {});
      const entries: ConsoleEntry[] = [];

      // Capture console.error messages
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          entries.push({ type: "console.error", text: msg.text() });
        }
      });

      // Capture uncaught page errors
      page.on("pageerror", (err) => {
        entries.push({ type: "uncaught", text: err.message, location: err.stack?.split("\n")[1]?.trim() });
      });

      try {
        await page.goto(pageUrl, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
        // Brief pause to let React hydration + async errors surface
        await page.waitForTimeout(1500);
        scannedPages.push(pageUrl);
      } catch {
        entries.push({ type: "navigation", text: `Failed to navigate to ${pageUrl}` });
        scannedPages.push(pageUrl);
      } finally {
        await page.close();
      }

      for (const entry of entries) {
        // Skip known noisy non-errors
        if (isIgnoredConsoleError(entry.text)) continue;

        const severity = classifyConsoleSeverity(entry.text);
        issues.push({
          type: "console_error",
          severity,
          pageUrl,
          message: entry.text.slice(0, 500),
          detail: {
            errorType: entry.type,
            location: entry.location ?? null,
          },
        });
      }
    }
  } finally {
    await closeBrowser(browser);
  }

  return {
    url,
    pages: scannedPages,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    issues,
  };
}

const IGNORED_PATTERNS = [
  /Download the React DevTools/i,
  /\[HMR\]/,
  /\[vite\]/i,
  /favicon\.ico/i,
  /Content Security Policy/i,
];

function isIgnoredConsoleError(text: string): boolean {
  return IGNORED_PATTERNS.some((p) => p.test(text));
}

function classifyConsoleSeverity(text: string): ScanIssue["severity"] {
  const lower = text.toLowerCase();
  if (/uncaught|unhandled|typeerror|referenceerror|cannot read|is not a function|hydrat/i.test(lower)) return "critical";
  if (/error|failed|exception/i.test(lower)) return "high";
  if (/warning|warn|deprecated/i.test(lower)) return "medium";
  return "low";
}
