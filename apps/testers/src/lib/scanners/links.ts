import { launchBrowser, getPage, closeBrowser } from "../browser.js";
import type { ScanIssue, ScanResult } from "../../types/index.js";

/**
 * Crawl the app starting from rootUrl, follow all internal links,
 * and flag any that return 404 or redirect loops.
 */
export async function scanBrokenLinks(options: {
  url: string;
  maxPages?: number;
  headed?: boolean;
  timeoutMs?: number;
}): Promise<ScanResult> {
  const { url, maxPages = 30, headed = false, timeoutMs = 12000 } = options;
  const start = Date.now();
  const issues: ScanIssue[] = [];

  const rootOrigin = (() => { try { return new URL(url).origin; } catch { return url; } })();

  // BFS crawl of internal links
  const visited = new Set<string>();
  const queue: Array<{ pageUrl: string; sourceUrl: string }> = [{ pageUrl: url, sourceUrl: "" }];

  const browser = await launchBrowser({ headless: !headed });
  try {
    while (queue.length > 0 && visited.size < maxPages) {
      const { pageUrl, sourceUrl } = queue.shift()!;
      const normalised = normaliseUrl(pageUrl);
      if (visited.has(normalised)) continue;
      visited.add(normalised);

      const page = await getPage(browser, {});
      let status = 200;
      let finalUrl = pageUrl;

      page.on("response", (resp) => {
        if (resp.url() === pageUrl || resp.url() === normalised) {
          status = resp.status();
        }
        // track redirects but don't flag them as issues
      });

      let hrefs: string[] = [];
      try {
        const response = await page.goto(pageUrl, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
        if (response) { status = response.status(); finalUrl = response.url(); }

        // Collect all <a href> links on this page
        hrefs = await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]"))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter(Boolean)
        );
      } catch (err) {
        status = 0;
      } finally {
        await page.close();
      }

      // Flag broken pages
      if (status === 404) {
        issues.push({
          type: "broken_link",
          severity: "high",
          pageUrl: sourceUrl || url,
          message: `404 Not Found: ${pageUrl}`,
          detail: { brokenUrl: pageUrl, sourceUrl, status },
        });
      } else if (status === 0) {
        issues.push({
          type: "broken_link",
          severity: "medium",
          pageUrl: sourceUrl || url,
          message: `Navigation failed: ${pageUrl}`,
          detail: { brokenUrl: pageUrl, sourceUrl, status },
        });
      }

      // Enqueue unvisited internal links
      for (const href of hrefs) {
        try {
          const linkUrl = new URL(href);
          if (linkUrl.origin === rootOrigin) {
            const clean = `${linkUrl.origin}${linkUrl.pathname}`;
            if (!visited.has(clean)) {
              queue.push({ pageUrl: clean, sourceUrl: finalUrl });
            }
          }
        } catch { /* external or invalid link */ }
      }
    }
  } finally {
    await closeBrowser(browser);
  }

  return {
    url,
    pages: Array.from(visited),
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    issues,
  };
}

function normaliseUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return rawUrl;
  }
}
