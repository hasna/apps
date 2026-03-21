import type { Browser, Page } from "playwright";
import type { Session, SessionOptions, SessionStatus } from "../types/index.js";
import { BrowserEngine, UseCase } from "../types/index.js";
import { SessionNotFoundError, BrowserError } from "../types/index.js";
import { createSession as dbCreateSession, getSession as dbGetSession, listSessions as dbListSessions, closeSession as dbCloseSession, updateSessionStatus, getSessionByName as dbGetSessionByName, renameSession as dbRenameSession } from "../db/sessions.js";
import { launchPlaywright, getPage as getPlaywrightPage, closeBrowser as closePlaywrightBrowser } from "../engines/playwright.js";
import { connectLightpanda } from "../engines/lightpanda.js";
import { BunWebViewSession, isBunWebViewAvailable } from "../engines/bun-webview.js";
import { selectEngine } from "../engines/selector.js";
import { enableNetworkLogging } from "./network.js";
import { enableConsoleCapture } from "./console.js";
import { applyStealthPatches } from "./stealth.js";
import { setupDialogHandler } from "./dialogs.js";

// ─── In-memory handle store ───────────────────────────────────────────────────

interface SessionHandle {
  browser: Browser | null;          // null for Bun.WebView sessions
  bunView: BunWebViewSession | null; // non-null for Bun.WebView sessions
  page: Page;                        // Playwright Page or BunWebViewSession proxy
  engine: BrowserEngine;
  cleanups: Array<() => void>;
  tokenBudget: { total: number; used: number };
}

const handles = new Map<string, SessionHandle>();

// ─── Bun.WebView → Playwright-compatible proxy ───────────────────────────────
// Wraps BunWebViewSession to satisfy the Page interface expected by the rest of the codebase.

function createBunProxy(view: BunWebViewSession): Page {
  return view as unknown as Page;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CreateSessionResult {
  session: Session;
  page: Page;
}

export async function createSession(opts: SessionOptions = {}): Promise<CreateSessionResult> {
  const engine = opts.engine === "auto" || !opts.engine
    ? selectEngine(opts.useCase ?? UseCase.SPA_NAVIGATE, opts.engine)
    : opts.engine;

  const resolvedEngine: BrowserEngine = engine === "auto" ? "playwright" : engine;

  let browser: Browser | null = null;
  let bunView: BunWebViewSession | null = null;
  let page: Page;

  if (resolvedEngine === "bun") {
    // ── Native Bun.WebView path ──
    if (!isBunWebViewAvailable()) {
      console.warn("[browser] Bun.WebView requested but not available — falling back to playwright. Run: bun upgrade --canary");
      // Fall through to playwright
      browser = await launchPlaywright({ headless: opts.headless ?? true, viewport: opts.viewport, userAgent: opts.userAgent });
      page = await getPlaywrightPage(browser, { viewport: opts.viewport, userAgent: opts.userAgent });
    } else {
      bunView = new BunWebViewSession({
        width: opts.viewport?.width ?? 1280,
        height: opts.viewport?.height ?? 720,
        profile: opts.name ?? undefined,
      });
      if (opts.stealth) {
        // Bun.WebView has isTrusted:true by default — stealth is built in
      }
      page = createBunProxy(bunView);
    }
  } else if (resolvedEngine === "lightpanda") {
    browser = await connectLightpanda();
    const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 720 } });
    page = await context.newPage();
  } else {
    // playwright or cdp both use Playwright under the hood
    browser = await launchPlaywright({
      headless: opts.headless ?? true,
      viewport: opts.viewport,
      userAgent: opts.userAgent,
    });
    page = await getPlaywrightPage(browser, { viewport: opts.viewport, userAgent: opts.userAgent });
  }

  // Compute session name, falling back gracefully if already taken
  const sessionName = opts.name ?? (opts.startUrl ? (() => { try { return new URL(opts.startUrl!).hostname; } catch { return undefined; } })() : undefined);
  const session = dbCreateSession({
    engine: bunView ? "bun" : (browser ? resolvedEngine : resolvedEngine),
    projectId: opts.projectId,
    agentId: opts.agentId,
    startUrl: opts.startUrl,
    name: sessionName,
  });

  // Apply stealth patches (Playwright only — Bun.WebView has built-in isTrusted)
  if (opts.stealth && !bunView) {
    try { await applyStealthPatches(page); } catch {}
  }

  // Auto-attach network + console logging (Playwright only — Bun.WebView doesn't support route interception yet)
  const cleanups: Array<() => void> = [];
  if (!bunView) {
    if (opts.captureNetwork !== false) {
      try { cleanups.push(enableNetworkLogging(page, session.id)); } catch {}
    }
    if (opts.captureConsole !== false) {
      try { cleanups.push(enableConsoleCapture(page, session.id)); } catch {}
    }
    // Dialog handler (Playwright only)
    try { cleanups.push(setupDialogHandler(page, session.id)); } catch {}
  } else {
    // Bun.WebView console capture via evaluate
    if (opts.captureConsole !== false) {
      try {
        const { logConsoleMessage } = await import("../db/console-log.js");
        await bunView.addInitScript(`
          (() => {
            const orig = { log: console.log, warn: console.warn, error: console.error, debug: console.debug, info: console.info };
            ['log','warn','error','debug','info'].forEach(level => {
              console[level] = (...args) => {
                orig[level](...args);
              };
            });
          })()
        `);
      } catch {}
    }
  }

  handles.set(session.id, { browser, bunView, page, engine: bunView ? "bun" : resolvedEngine, cleanups, tokenBudget: { total: 0, used: 0 } });

  if (opts.startUrl) {
    try {
      if (bunView) {
        await bunView.goto(opts.startUrl);
      } else {
        await page.goto(opts.startUrl, { waitUntil: "domcontentloaded" });
      }
    } catch {
      // Non-fatal: session still created
    }
  }

  return { session, page };
}

// ─── Session access ───────────────────────────────────────────────────────────

export function getSessionPage(sessionId: string): Page {
  const handle = handles.get(sessionId);
  if (!handle) throw new SessionNotFoundError(sessionId);

  // Health check
  try {
    if (handle.bunView) {
      // Bun.WebView: check it's still open by accessing url
      void handle.bunView.url();
    } else {
      handle.page.url(); // throws if browser/context is closed
    }
  } catch {
    handles.delete(sessionId);
    throw new SessionNotFoundError(sessionId);
  }
  return handle.page;
}

export function getSessionBunView(sessionId: string): BunWebViewSession | null {
  return handles.get(sessionId)?.bunView ?? null;
}

export function isBunSession(sessionId: string): boolean {
  return handles.get(sessionId)?.engine === "bun";
}

export function getSessionBrowser(sessionId: string): Browser {
  const handle = handles.get(sessionId);
  if (!handle) throw new SessionNotFoundError(sessionId);
  if (!handle.browser) throw new BrowserError("This session uses Bun.WebView (no Playwright browser)", "NO_PLAYWRIGHT_BROWSER");
  return handle.browser;
}

export function getSessionEngine(sessionId: string): BrowserEngine {
  const handle = handles.get(sessionId);
  if (!handle) throw new SessionNotFoundError(sessionId);
  return handle.engine;
}

export function hasActiveHandle(sessionId: string): boolean {
  return handles.has(sessionId);
}

export function setSessionPage(sessionId: string, page: Page): void {
  const handle = handles.get(sessionId);
  if (!handle) throw new SessionNotFoundError(sessionId);
  handle.page = page;
}

export async function closeSession(sessionId: string): Promise<Session> {
  const handle = handles.get(sessionId);
  if (handle) {
    for (const cleanup of handle.cleanups) {
      try { cleanup(); } catch {}
    }
    if (handle.bunView) {
      try { await handle.bunView.close(); } catch {}
    } else {
      try { await handle.page.context().close(); } catch {}
      try { if (handle.browser) await closePlaywrightBrowser(handle.browser); } catch {}
    }
    handles.delete(sessionId);
  }
  return dbCloseSession(sessionId);
}

export function getSession(sessionId: string): Session {
  return dbGetSession(sessionId);
}

export function listSessions(filter?: { status?: SessionStatus; projectId?: string }): Session[] {
  return dbListSessions(filter);
}

export function getActiveSessions(): Session[] {
  return dbListSessions({ status: "active" });
}

export async function closeAllSessions(): Promise<void> {
  for (const [id] of handles) {
    await closeSession(id).catch(() => {});
  }
}

export function getSessionByName(name: string) {
  return dbGetSessionByName(name);
}

export function renameSession(id: string, name: string) {
  return dbRenameSession(id, name);
}

export function getTokenBudget(sessionId: string): { total: number; used: number } | null {
  const handle = handles.get(sessionId);
  return handle ? handle.tokenBudget : null;
}
