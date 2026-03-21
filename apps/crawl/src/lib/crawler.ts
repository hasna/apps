import type {
  Crawl,
  CrawlOptions,
  CreateCrawlInput,
  Page,
} from "../types/index.js";
import { fetchPage } from "./fetcher.js";
import { extractContent } from "./extractor.js";
import { fetchRobotsTxt } from "./robots.js";
import { isPdf, extractPdfText } from "./pdf.js";
import { getConfig } from "./config.js";
import { createCrawl, getCrawl, updateCrawl } from "../db/crawls.js";
import {
  createPage,
  getPageByUrl,
  listPages,
  savePageVersion,
  updatePage,
} from "../db/pages.js";
import { diffTexts } from "./diff.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isSameDomain(url: string, domain: string): boolean {
  try {
    return new URL(url).hostname === domain;
  } catch {
    return false;
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Strip fragment
    u.hash = "";
    // Normalize trailing slash for root paths
    return u.toString();
  } catch {
    return url;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderWithPlaywright(url: string): Promise<string> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      const html = await page.content();
      return html;
    } finally {
      await browser.close();
    }
  } catch {
    // Playwright not installed or failed — fall back to regular fetch
    const result = await fetchPage(url);
    return result.html;
  }
}

async function captureScreenshot(
  url: string,
  crawlId: string,
  pageId: string
): Promise<string | null> {
  try {
    const { chromium } = await import("playwright");
    const config = getConfig();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: config.screenshotViewport,
      });
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      const screenshotDir = `${process.env.HOME ?? "/tmp"}/.open-crawl/screenshots/${crawlId}`;
      const { mkdirSync } = await import("fs");
      mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = `${screenshotDir}/${pageId}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return screenshotPath;
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

// ─── shouldCrawlUrl ───────────────────────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp", ".tiff",
  ".css", ".js", ".mjs", ".jsx", ".ts", ".tsx",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp4", ".mp3", ".wav", ".ogg", ".avi", ".mov", ".webm",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".rar", ".7z",
  ".exe", ".dmg", ".pkg", ".deb", ".rpm",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
]);

export function shouldCrawlUrl(url: string): boolean {
  try {
    const u = new URL(url);
    // Skip non-http protocols
    if (!u.protocol.startsWith("http")) return false;
    // Skip fragments-only
    if (u.pathname === "/" && u.hash) return false;
    // Check extension
    const ext = u.pathname.match(/(\.[a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (ext && BINARY_EXTENSIONS.has(ext)) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── crawlUrl ─────────────────────────────────────────────────────────────────

export async function crawlUrl(
  url: string,
  crawlId: string,
  options?: CrawlOptions
): Promise<Page> {
  const config = getConfig();
  const normalizedUrl = normalizeUrl(url);

  // Use Playwright renderer if requested
  let html: string;
  let statusCode = 200;
  let contentType = "text/html";
  let byteSize = 0;

  if (options?.render ?? config.defaultRender) {
    html = await renderWithPlaywright(normalizedUrl);
    byteSize = Buffer.byteLength(html, "utf-8");
  } else {
    const fetchOptions = {
      headers: options?.headers,
      cookies: options?.cookies,
      timeout: options?.timeout,
      userAgent: options?.userAgent,
      delay: options?.delay,
    };
    const result = await fetchPage(normalizedUrl, fetchOptions);
    html = result.html;
    statusCode = result.statusCode;
    contentType = result.contentType;
    byteSize = result.byteSize;
  }

  // Handle PDF content
  let textContent: string;
  let markdownContent: string;
  let title: string | undefined;
  if (isPdf(contentType)) {
    try {
      const pdfResult = await extractPdfText(Buffer.from(html, "binary").buffer);
      textContent = pdfResult.text;
      markdownContent = pdfResult.text;
      title = `PDF (${pdfResult.pageCount} page${pdfResult.pageCount !== 1 ? "s" : ""})`;
    } catch {
      textContent = "";
      markdownContent = "";
    }
  } else {
    const extracted = extractContent(html, normalizedUrl);
    textContent = extracted.text;
    markdownContent = extracted.markdown;
    title = extracted.title ?? undefined;
  }

  const extracted = isPdf(contentType)
    ? null
    : extractContent(html, normalizedUrl);

  const pageInput = {
    crawlId,
    url: normalizedUrl,
    statusCode,
    contentType,
    title: title ?? extracted?.title ?? undefined,
    description: extracted?.description ?? undefined,
    textContent,
    markdownContent,
    htmlContent: options?.storeHtml ?? config.storeHtml ? html : undefined,
    metadata: extracted?.metadata ?? {},
    wordCount: textContent.split(/\s+/).filter(Boolean).length,
    byteSize,
  };

  const page = createPage(pageInput);

  // Capture screenshot if requested
  if (options?.screenshot) {
    const screenshotPath = await captureScreenshot(normalizedUrl, crawlId, page.id);
    if (screenshotPath) {
      updatePage(page.id, { screenshotPath });
    }
  }

  // Increment crawl pages_crawled counter
  const currentCrawl = getCrawl(crawlId);
  if (currentCrawl) {
    updateCrawl(crawlId, { pagesCrawled: currentCrawl.pagesCrawled + 1 });
  }

  return page;
}

// ─── startCrawl ───────────────────────────────────────────────────────────────

export async function startCrawl(input: CreateCrawlInput): Promise<Crawl> {
  const config = getConfig();
  const options: CrawlOptions = input.options ?? {};

  const maxDepth = input.depth ?? options.depth ?? config.maxDepth;
  const maxPages = input.maxPages ?? options.maxPages ?? config.maxPages;
  const delay = options.delay ?? config.defaultDelay;
  const maxConcurrent = options.maxConcurrent ?? config.maxConcurrent;
  const respectRobots = options.respectRobots ?? true;

  // Create the crawl record (starts as 'pending', we immediately set to 'running')
  const crawl = createCrawl({ ...input, depth: maxDepth, maxPages });
  updateCrawl(crawl.id, { status: "running" });

  const domain = extractDomain(input.url);
  const visited = new Set<string>();
  let pageCount = 0;

  // Fetch robots.txt once for this domain
  let robotsChecker: ((url: string) => boolean) | null = null;
  if (respectRobots) {
    const robots = await fetchRobotsTxt(domain, options.userAgent ?? config.userAgent);
    robotsChecker = robots.isAllowed.bind(robots);
  }

  try {
    // BFS queue: [url, depth]
    const queue: Array<[string, number]> = [[normalizeUrl(input.url), 0]];

    while (queue.length > 0 && pageCount < maxPages) {
      // Process up to maxConcurrent URLs in parallel
      const batch = queue.splice(0, maxConcurrent);
      const promises = batch.map(async ([url, depth]) => {
        const normalized = normalizeUrl(url);
        if (visited.has(normalized)) return [];
        if (!isSameDomain(normalized, domain)) return [];
        if (robotsChecker && !robotsChecker(normalized)) return [];

        visited.add(normalized);

        // Skip if already crawled in this crawl
        const existing = getPageByUrl(crawl.id, normalized);
        if (existing) return [];

        const page = await crawlUrl(normalized, crawl.id, options);
        pageCount++;
        input.options?.onProgress?.({ url: normalized, pageNumber: pageCount, total: maxPages });

        // Collect internal links for further crawling
        const newLinks: Array<[string, number]> = [];
        if (depth < maxDepth && !page.metadata?.nofollow) {
          const links = page.metadata?.links ?? [];
          for (const link of links) {
            const linkNorm = normalizeUrl(link.href);
            if (
              linkNorm &&
              !visited.has(linkNorm) &&
              isSameDomain(linkNorm, domain) &&
              shouldCrawlUrl(linkNorm)
            ) {
              // include filter — URL must match at least one pattern if include is set
              if (options?.include && options.include.length > 0) {
                const path = new URL(linkNorm).pathname;
                if (!options.include.some(p => path.includes(p))) continue;
              }
              // exclude filter — skip if URL matches any exclude pattern
              if (options?.exclude && options.exclude.length > 0) {
                const path = new URL(linkNorm).pathname;
                if (options.exclude.some(p => path.includes(p))) continue;
              }
              newLinks.push([linkNorm, depth + 1]);
            }
          }
        }

        if (delay > 0) {
          await sleep(delay);
        }

        return newLinks;
      });

      const results = await Promise.all(promises);
      for (const newLinks of results) {
        for (const entry of newLinks) {
          const [url] = entry;
          if (!visited.has(normalizeUrl(url)) && pageCount + queue.length < maxPages) {
            queue.push(entry);
          }
        }
      }
    }

    const completedAt = new Date().toISOString();
    updateCrawl(crawl.id, {
      status: "completed",
      completedAt,
      pagesCrawled: pageCount,
    });
  } catch (err) {
    updateCrawl(crawl.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }

  return getCrawl(crawl.id)!;
}

// ─── batchCrawl ───────────────────────────────────────────────────────────────

export async function batchCrawl(
  urls: string[],
  options?: CrawlOptions
): Promise<Crawl> {
  if (urls.length === 0) {
    throw new Error("batchCrawl requires at least one URL.");
  }

  const firstUrl = urls[0]!;
  const crawl = createCrawl({
    url: firstUrl,
    depth: 0,
    maxPages: urls.length,
    options,
  });
  updateCrawl(crawl.id, { status: "running" });

  let pageCount = 0;

  try {
    const maxConcurrent = options?.maxConcurrent ?? getConfig().maxConcurrent;
    const delay = options?.delay ?? 0;

    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);
      await Promise.all(
        batch.map(async (url) => {
          await crawlUrl(url, crawl.id, options);
          pageCount++;
        })
      );
      if (delay > 0 && i + maxConcurrent < urls.length) {
        await sleep(delay);
      }
    }

    updateCrawl(crawl.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      pagesCrawled: pageCount,
    });
  } catch (err) {
    updateCrawl(crawl.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }

  return getCrawl(crawl.id)!;
}

// ─── resumeCrawl ──────────────────────────────────────────────────────────────

export async function resumeCrawl(crawlId: string): Promise<Crawl> {
  const crawl = getCrawl(crawlId);
  if (!crawl) throw new Error(`Crawl not found: ${crawlId}`);

  // Get already-visited URLs
  const existingPages = listPages(crawlId, { limit: 10000 });
  const visited = new Set(existingPages.map(p => normalizeUrl(p.url)));

  // Reset status to running
  updateCrawl(crawlId, { status: "running", updatedAt: new Date().toISOString() });

  const config = getConfig();
  const options = crawl.options;

  // Re-run BFS from the original URL, skipping already-visited
  try {
    const queue: Array<{ url: string; depth: number }> = [{ url: crawl.url, depth: 0 }];
    let pageCount = existingPages.length;

    while (queue.length > 0 && pageCount < crawl.maxPages) {
      const item = queue.shift();
      if (!item) break;
      const { url: currentUrl, depth } = item;
      const normalized = normalizeUrl(currentUrl);
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      try {
        await sleep(options.delay ?? config.defaultDelay);
        const page = await crawlUrl(currentUrl, crawlId, options);
        pageCount++;
        updateCrawl(crawlId, { pagesCrawled: pageCount });

        if (depth < crawl.depth && page.metadata?.links) {
          const domain = extractDomain(crawl.url);
          for (const link of page.metadata.links) {
            if (link.href && isSameDomain(link.href, domain) && !visited.has(normalizeUrl(link.href)) && shouldCrawlUrl(link.href)) {
              queue.push({ url: link.href, depth: depth + 1 });
            }
          }
        }
      } catch {
        // skip failed pages
      }
    }

    updateCrawl(crawlId, {
      status: "completed",
      completedAt: new Date().toISOString(),
      pagesCrawled: pageCount,
    });
  } catch (err) {
    updateCrawl(crawlId, { status: "failed", errorMessage: String(err) });
  }

  return getCrawl(crawlId)!;
}

// ─── recrawl ──────────────────────────────────────────────────────────────────

export async function recrawl(crawlId: string): Promise<Crawl> {
  const crawl = getCrawl(crawlId);
  if (!crawl) throw new Error(`Crawl not found: ${crawlId}`);

  updateCrawl(crawlId, { status: "running" });

  let pageCount = 0;

  try {
    const batchSize = 50;
    let offset = 0;

    while (true) {
      const pages = listPages(crawlId, { limit: batchSize, offset });
      if (pages.length === 0) break;

      for (const page of pages) {
        const oldText = page.textContent ?? "";

        const fetchResult = await fetchPage(page.url, {
          headers: crawl.options.headers,
          cookies: crawl.options.cookies,
          timeout: crawl.options.timeout,
          userAgent: crawl.options.userAgent,
          delay: crawl.options.delay,
        });

        const extracted = extractContent(fetchResult.html, page.url);
        const newText = extracted.text;
        const diffSummary = diffTexts(oldText, newText);

        savePageVersion(page.id, oldText || null, diffSummary);

        // Re-create the page entry with updated content by creating a new version record
        // (pages.ts does not export updatePage; we record versions instead)
        savePageVersion(page.id, newText || null, `recrawl: ${diffSummary}`);

        pageCount++;
      }

      if (pages.length < batchSize) break;
      offset += batchSize;
    }

    updateCrawl(crawlId, {
      status: "completed",
      completedAt: new Date().toISOString(),
      pagesCrawled: pageCount,
    });
  } catch (err) {
    updateCrawl(crawlId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }

  return getCrawl(crawlId)!;
}
