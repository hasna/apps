import type { Database } from "bun:sqlite";
import type { LogEntry, Page, PerformanceSnapshot } from "../types/index.ts";
import type { PageAuth } from "./page-auth.ts";
import { ingestBatch } from "./ingest.ts";
import { getPageAuth } from "./page-auth.ts";
import { saveSnapshot } from "./perf.ts";
import { getPage, touchPage } from "./projects.ts";

export interface ScanResult {
  logsCollected: number;
  errorsFound: number;
  perfScore: number | null;
}

/**
 * The data-plane surface a headless scan needs, independent of the storage
 * backend. {@link LocalStore} binds it to SQLite; {@link ApiStore} binds it to
 * the hosted /v1 data plane (the browser itself always runs on the machine
 * executing the CLI — the transport requires it).
 */
export interface ScanContext {
  getPage(pageId: string): Promise<Pick<Page, "id" | "url"> | null>;
  getPageAuth(
    pageId: string,
  ): Promise<Pick<PageAuth, "type" | "credentials"> | null>;
  ingest(entries: LogEntry[]): Promise<void>;
  touchPage(pageId: string): Promise<void>;
  savePerfSnapshot(
    snapshot: Omit<PerformanceSnapshot, "id" | "timestamp">,
  ): Promise<void>;
}

/**
 * Run one headless page scan against any backend via {@link ScanContext}.
 * Identical execution on both tiers: the browser runs here (client-side),
 * while every result — console logs, page errors, perf metrics — is delivered
 * through the context's data plane.
 */
export async function scanPageWithContext(
  ctx: ScanContext,
  projectId: string,
  pageId: string,
  urlOverride?: string,
): Promise<ScanResult> {
  const page = await ctx.getPage(pageId);
  const url = urlOverride || page?.url;
  if (!url) throw new Error(`No URL for page ${pageId}`);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  // Apply page auth if configured (the hosted tier has no page-auth store, so
  // its context returns null and the scan proceeds unauthenticated).
  const auth = await ctx.getPageAuth(pageId);
  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    userAgent: "Mozilla/5.0 (@hasna/logs scanner) AppleWebKit/537.36",
  };
  if (auth?.type === "cookie") {
    try {
      contextOptions.storageState = JSON.parse(auth.credentials);
    } catch {
      /* invalid */
    }
  } else if (auth?.type === "basic") {
    const [username, password] = auth.credentials.split(":");
    contextOptions.httpCredentials = {
      username: username ?? "",
      password: password ?? "",
    };
  }

  const context = await browser.newContext(contextOptions);

  if (auth?.type === "bearer") {
    await context.route("**/*", (route) => {
      route.continue({
        headers: {
          ...route.request().headers(),
          Authorization: `Bearer ${auth.credentials}`,
        },
      });
    });
  }

  const browserPage = await context.newPage();

  const collected: LogEntry[] = [];
  let errorsFound = 0;

  // Capture console output
  browserPage.on("console", (msg) => {
    const level =
      msg.type() === "error"
        ? "error"
        : msg.type() === "warning"
          ? "warn"
          : msg.type() === "info"
            ? "info"
            : "debug";
    if (level === "error") errorsFound++;
    collected.push({
      project_id: projectId,
      page_id: pageId,
      level: level as LogEntry["level"],
      source: "scanner",
      message: msg.text(),
      url,
    });
  });

  // Capture page errors (uncaught JS exceptions)
  browserPage.on("pageerror", (err) => {
    errorsFound++;
    collected.push({
      project_id: projectId,
      page_id: pageId,
      level: "error",
      source: "scanner",
      message: err.message,
      stack_trace: err.stack,
      url,
    });
  });

  // Capture network failures
  browserPage.on("requestfailed", (req) => {
    collected.push({
      project_id: projectId,
      page_id: pageId,
      level: "warn",
      source: "scanner",
      message: `Network request failed: ${req.url()} — ${req.failure()?.errorText ?? "unknown"}`,
      url,
    });
  });

  const perfScore: number | null = null;

  try {
    await browserPage.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    // Try basic perf metrics via CDP
    try {
      const metrics = await browserPage.evaluate(() => {
        type NavigationTimingLike = {
          responseStart?: number;
          requestStart?: number;
          domContentLoadedEventEnd?: number;
          startTime?: number;
        };
        type PaintTimingLike = { startTime?: number };
        const perf = globalThis.performance as {
          getEntriesByType: (type: string) => NavigationTimingLike[];
          getEntriesByName: (name: string) => PaintTimingLike[];
        };
        const nav = perf.getEntriesByType("navigation")[0];
        const paint = perf.getEntriesByName("first-contentful-paint")[0];
        return {
          ttfb:
            nav?.responseStart !== undefined && nav.requestStart !== undefined
              ? nav.responseStart - nav.requestStart
              : null,
          fcp: paint?.startTime ?? null,
          domLoad:
            nav?.domContentLoadedEventEnd !== undefined &&
            nav.startTime !== undefined
              ? nav.domContentLoadedEventEnd - nav.startTime
              : null,
        };
      });
      // Store what we can without full Lighthouse
      if (metrics.fcp !== null || metrics.ttfb !== null) {
        await ctx.savePerfSnapshot({
          project_id: projectId,
          page_id: pageId,
          url,
          fcp: metrics.fcp,
          ttfb: metrics.ttfb,
          lcp: null,
          cls: null,
          tti: metrics.domLoad,
          score: null,
          raw_audit: JSON.stringify(metrics),
        });
      }
    } catch {
      // perf metrics optional
    }
  } finally {
    await browser.close();
  }

  if (collected.length > 0) {
    await ctx.ingest(collected);
    if (page) await ctx.touchPage(pageId);
  }

  return { logsCollected: collected.length, errorsFound, perfScore };
}

/** SQLite-backed {@link ScanContext} (the local tier). */
function localScanContext(db: Database): ScanContext {
  return {
    getPage: async (pageId) => getPage(db, pageId),
    getPageAuth: async (pageId) => getPageAuth(db, pageId),
    ingest: async (entries) => {
      ingestBatch(db, entries);
    },
    touchPage: async (pageId) => {
      touchPage(db, pageId);
    },
    savePerfSnapshot: async (snapshot) => {
      saveSnapshot(db, snapshot);
    },
  };
}

/**
 * SQLite-backed scan (the local tier). The hosted tier runs the same
 * execution through {@link ScanContext} via ApiStore.runScanJob.
 */
export function scanPage(
  db: Database,
  projectId: string,
  pageId: string,
  urlOverride?: string,
): Promise<ScanResult> {
  return scanPageWithContext(localScanContext(db), projectId, pageId, urlOverride);
}
