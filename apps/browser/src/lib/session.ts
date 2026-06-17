import type { Browser, Page } from "playwright";
import type { Session, SessionOptions, SessionStatus } from "../types/index.js";
import { BrowserEngine, UseCase } from "../types/index.js";
import { SessionNotFoundError, BrowserError } from "../types/index.js";
import { createSession as dbCreateSession, getSession as dbGetSession, listSessions as dbListSessions, closeSession as dbCloseSession, updateSessionStatus, getSessionByName as dbGetSessionByName, renameSession as dbRenameSession, getActiveSessionForAgent as dbGetActiveSessionForAgent, getDefaultActiveSession as dbGetDefaultActiveSession, countActiveSessions as dbCountActiveSessions } from "../db/sessions.js";
import { launchPlaywright, getPage as getPlaywrightPage, closeBrowser as closePlaywrightBrowser, BrowserPool } from "../engines/playwright.js";
import { connectLightpanda } from "../engines/lightpanda.js";
import { BunWebViewSession, isBunWebViewAvailable } from "../engines/bun-webview.js";
import { selectEngine } from "../engines/selector.js";
import { launchTui, closeTui, type TuiSession } from "../engines/tui.js";
import { createExtensionPage, isExtensionPage } from "../engines/extension.js";
import { stopTuiRecording } from "./tui-recording.js";
import { enableNetworkLogging } from "./network.js";
import { enableConsoleCapture } from "./console.js";
import { applyStealthPatches } from "./stealth.js";
import { setupDialogHandler } from "./dialogs.js";

// ─── In-memory handle store ───────────────────────────────────────────────────

interface SessionHandle {
  browser: Browser | null;          // null for Bun.WebView sessions
  bunView: BunWebViewSession | null; // non-null for Bun.WebView sessions
  tuiSession: TuiSession | null;    // non-null for TUI sessions
  page: Page;                        // Playwright Page, BunWebViewSession proxy, or extension proxy
  engine: BrowserEngine;
  cleanups: Array<() => void | Promise<void>>;
  tokenBudget: { total: number; used: number };
  lastActivity: number;              // Date.now() timestamp for TTL
  autoGallery: boolean;
  startUrl: string;         // shell command for TUI (startUrl from SessionOptions)
}

const handles = new Map<string, SessionHandle>();

// ─── Shared browser pool ──────────────────────────────────────────────────────
const pool = new BrowserPool(5); // Up to 5 concurrent browsers

// ─── Session TTL — auto-close stale sessions ────────────────────────────────
const SESSION_TTL_MS = (parseInt(process.env["SESSION_TTL_MINUTES"] ?? "10", 10)) * 60_000;

const ttlInterval = setInterval(async () => {
  const now = Date.now();
  for (const [id, handle] of handles) {
    if (now - handle.lastActivity > SESSION_TTL_MS) {
      try { await closeSession(id); } catch {}
    }
  }
}, 60_000); // Check every 60 seconds

// Don't keep the process alive just for TTL cleanup
if (ttlInterval.unref) ttlInterval.unref();

// ─── Periodic DB pruning — prevent unbounded table growth ──────────────────
const DB_PRUNE_INTERVAL_MS = 30 * 60_000; // Every 30 minutes
const DB_RETENTION_HOURS = 24;

const dbPruneInterval = setInterval(() => {
  (async () => {
    try {
      const { getDatabase } = await import("../db/schema.js");
      const db = getDatabase();
      const cutoff = new Date(Date.now() - DB_RETENTION_HOURS * 3_600_000).toISOString();
      // Prune old network_log and console_log entries for closed sessions
      db.prepare("DELETE FROM network_log WHERE session_id IN (SELECT id FROM sessions WHERE status != 'active') AND timestamp < ?").run(cutoff);
      db.prepare("DELETE FROM console_log WHERE session_id IN (SELECT id FROM sessions WHERE status != 'active') AND timestamp < ?").run(cutoff);
      db.prepare("DELETE FROM snapshots WHERE session_id IN (SELECT id FROM sessions WHERE status != 'active') AND timestamp < ?").run(cutoff);
    } catch {}
  })();
}, DB_PRUNE_INTERVAL_MS);
if (dbPruneInterval.unref) dbPruneInterval.unref();

// ─── Bun.WebView → Playwright-compatible proxy ───────────────────────────────
// Wraps BunWebViewSession to satisfy the Page interface expected by the rest of the codebase.

function createBunProxy(view: BunWebViewSession): Page {
  return view as unknown as Page;
}

function attachPlaywrightListeners(
  page: Page,
  sessionId: string,
  cleanups: Array<() => void | Promise<void>>,
  opts: { captureNetwork?: boolean; captureConsole?: boolean } = {},
): void {
  if (opts.captureNetwork !== false) {
    try { cleanups.push(enableNetworkLogging(page, sessionId)); } catch {}
  }
  if (opts.captureConsole !== false) {
    try { cleanups.push(enableConsoleCapture(page, sessionId)); } catch {}
  }
  try { cleanups.push(setupDialogHandler(page, sessionId)); } catch {}
}

function detachPlaywrightListeners(cleanups: Array<() => void | Promise<void>>): void {
  // Index 0 is engine-specific shutdown (e.g. closeTui); listener cleanups follow.
  while (cleanups.length > 1) {
    const cleanup = cleanups.pop();
    try { cleanup?.(); } catch {}
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CreateSessionResult {
  session: Session;
  page: Page;
}

export async function createSession(opts: SessionOptions = {}): Promise<CreateSessionResult> {
  // CDP attach: connect to existing browser
  if (opts.cdpUrl) {
    const { connectToExistingBrowser } = await import("../engines/cdp.js");
    const cdpBrowser = await connectToExistingBrowser(opts.cdpUrl);
    const contexts = cdpBrowser.contexts();
    const context = contexts.length > 0 ? contexts[0] : await cdpBrowser.newContext();
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    const session = dbCreateSession({
      engine: "cdp",
      projectId: opts.projectId,
      agentId: opts.agentId,
      startUrl: page.url(),
      name: opts.name ?? "attached",
    });

    const cleanups: Array<() => void | Promise<void>> = [];
    if (opts.captureNetwork !== false) {
      try { cleanups.push(enableNetworkLogging(page, session.id)); } catch {}
    }
    if (opts.captureConsole !== false) {
      try { cleanups.push(enableConsoleCapture(page, session.id)); } catch {}
    }
    try { cleanups.push(setupDialogHandler(page, session.id)); } catch {}

    handles.set(session.id, { browser: cdpBrowser, bunView: null, tuiSession: null, page, engine: "cdp", cleanups, tokenBudget: { total: 0, used: 0 }, lastActivity: Date.now(), autoGallery: opts.autoGallery ?? false, startUrl: opts.startUrl ?? "" });

    return { session, page };
  }

  const engine = opts.engine === "auto" || !opts.engine
    ? selectEngine(opts.useCase ?? UseCase.SPA_NAVIGATE, opts.engine)
    : opts.engine;

  const resolvedEngine: BrowserEngine = engine === "auto" ? "playwright" : engine;

  let browser: Browser | null = null;
  let bunView: BunWebViewSession | null = null;
  let page: Page;
  let actualEngine: BrowserEngine = resolvedEngine;

  if (resolvedEngine === "bun") {
    if (!isBunWebViewAvailable()) {
      console.warn("[browser] Bun.WebView requested but not available — falling back to playwright. Run: bun upgrade --canary");
      actualEngine = "playwright";
      browser = await launchPlaywright({ headless: opts.headless ?? true, viewport: opts.viewport, userAgent: opts.userAgent });
      page = await getPlaywrightPage(browser, { viewport: opts.viewport, userAgent: opts.userAgent });
    } else {
      // Create the WebView and verify it actually works (on Linux it needs Chrome CDP)
      const testView = new BunWebViewSession({
        width: opts.viewport?.width ?? 1280,
        height: opts.viewport?.height ?? 720,
        profile: opts.name ?? undefined,
      });

      // Quick smoke test: on Linux, Bun.WebView requires Chrome — if Chrome isn't
      // installed, the navigate() call will throw "Chrome connection is not available"
      let bunWorks = true;
      try {
        await testView.goto("data:text/html,<html></html>");
      } catch {
        bunWorks = false;
        try { await testView.close(); } catch {}
      }

      if (!bunWorks) {
        console.warn("[browser] Bun.WebView exists but Chrome not available — falling back to playwright");
        actualEngine = "playwright";
        browser = await launchPlaywright({ headless: opts.headless ?? true, viewport: opts.viewport, userAgent: opts.userAgent });
        page = await getPlaywrightPage(browser, { viewport: opts.viewport, userAgent: opts.userAgent });
      } else {
        actualEngine = "bun";
        bunView = testView;
        if (opts.stealth) {
          // Bun.WebView has isTrusted:true by default — stealth is built in
        }
        page = createBunProxy(bunView);
      }
    }
  } else if (resolvedEngine === "lightpanda") {
    browser = await connectLightpanda();
    const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 720 } });
    page = await context.newPage();
  } else if (resolvedEngine === "tui") {
    // ── TUI engine: ttyd + Playwright ──
    const command = opts.startUrl ?? "bash";
    const tuiSess = await launchTui(command, {
      headless: opts.headless ?? true,
      viewport: opts.viewport,
      theme: opts.tuiTheme ?? "system",
      fontSize: opts.tuiFontSize,
      method: opts.tuiMethod ?? "buffer",
    });
    browser = tuiSess.browser;
    page = tuiSess.page;

    const session = dbCreateSession({
      engine: "tui",
      projectId: opts.projectId,
      agentId: opts.agentId,
      startUrl: opts.startUrl,
      name: opts.name ?? "tui",
    });

    const cleanups: Array<() => void | Promise<void>> = [];
    cleanups.push(() => closeTui(tuiSess));

    attachPlaywrightListeners(page, session.id, cleanups, {
      captureNetwork: opts.captureNetwork,
      captureConsole: opts.captureConsole,
    });

    handles.set(session.id, { browser, bunView: null, tuiSession: tuiSess, page, engine: "tui", cleanups, tokenBudget: { total: 0, used: 0 }, lastActivity: Date.now(), autoGallery: opts.autoGallery ?? false, startUrl: opts.startUrl ?? "bash" });

    return { session, page };
  } else if (resolvedEngine === "extension") {
    const session = dbCreateSession({
      engine: "extension",
      projectId: opts.projectId,
      agentId: opts.agentId,
      startUrl: opts.startUrl,
      name: opts.name ?? "extension",
    });

    page = createExtensionPage({
      sessionId: session.id,
      viewport: opts.viewport,
      serverUrl: opts.extensionServerUrl,
    });

    handles.set(session.id, { browser: null, bunView: null, tuiSession: null, page, engine: "extension", cleanups: [], tokenBudget: { total: 0, used: 0 }, lastActivity: Date.now(), autoGallery: opts.autoGallery ?? false, startUrl: opts.startUrl ?? "" });

    if (opts.startUrl) {
      try { await page.goto(opts.startUrl, { waitUntil: "domcontentloaded" }); } catch {}
    }

    return { session, page };
  } else {
    // playwright or cdp both use Playwright under the hood — use shared pool
    browser = await pool.acquire(opts.headless ?? true);
    if (opts.storageState) {
      const { loadStatePath } = await import("./storage-state.js");
      const statePath = loadStatePath(opts.storageState);
      if (statePath) {
        const context = await browser.newContext({
          viewport: opts.viewport ?? { width: 1280, height: 720 },
          userAgent: opts.userAgent,
          storageState: statePath,
        });
        page = await context.newPage();
      } else {
        page = await getPlaywrightPage(browser, { viewport: opts.viewport, userAgent: opts.userAgent });
      }
    } else {
      page = await getPlaywrightPage(browser, { viewport: opts.viewport, userAgent: opts.userAgent });
    }
  }

  // Compute session name, falling back gracefully if already taken
  const sessionName = opts.name ?? (opts.startUrl ? (() => { try { return new URL(opts.startUrl!).hostname; } catch { return undefined; } })() : undefined);
  const session = dbCreateSession({
    engine: actualEngine,
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
  const cleanups: Array<() => void | Promise<void>> = [];
  if (!bunView) {
    attachPlaywrightListeners(page, session.id, cleanups, {
      captureNetwork: opts.captureNetwork,
      captureConsole: opts.captureConsole,
    });
  }

  handles.set(session.id, { browser, bunView, tuiSession: null, page, engine: actualEngine, cleanups, tokenBudget: { total: 0, used: 0 }, lastActivity: Date.now(), autoGallery: opts.autoGallery ?? false, startUrl: opts.startUrl ?? "" });

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
    } else if (isExtensionPage(handle.page)) {
      handle.page.url();
    } else {
      handle.page.url(); // throws if browser/context is closed
    }
  } catch {
    handles.delete(sessionId);
    throw new SessionNotFoundError(sessionId);
  }
  handle.lastActivity = Date.now();
  return handle.page;
}

export function getSessionBunView(sessionId: string): BunWebViewSession | null {
  return handles.get(sessionId)?.bunView ?? null;
}

export function isBunSession(sessionId: string): boolean {
  const handle = handles.get(sessionId);
  return handle?.engine === "bun" && handle.bunView !== null;
}

export function isExtensionSession(sessionId: string): boolean {
  const handle = handles.get(sessionId);
  return handle?.engine === "extension" && isExtensionPage(handle.page);
}

export function getSessionBrowser(sessionId: string): Browser {
  const handle = handles.get(sessionId);
  if (!handle) throw new SessionNotFoundError(sessionId);
  if (!handle.browser) throw new BrowserError(`This session uses ${handle.engine} (no Playwright browser)`, "NO_PLAYWRIGHT_BROWSER");
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

export function getSessionTuiSession(sessionId: string): TuiSession | null {
  return handles.get(sessionId)?.tuiSession ?? null;
}

export function setSessionTui(sessionId: string, tuiSess: TuiSession): void {
  const handle = handles.get(sessionId);
  if (!handle) throw new SessionNotFoundError(sessionId);
  detachPlaywrightListeners(handle.cleanups);
  handle.tuiSession = tuiSess;
  handle.page = tuiSess.page;
  if (tuiSess.browser !== handle.browser) {
    handle.browser = tuiSess.browser;
  }
  attachPlaywrightListeners(tuiSess.page, sessionId, handle.cleanups, {
    captureNetwork: true,
    captureConsole: true,
  });
  handle.lastActivity = Date.now();
}

export function getSessionCommand(sessionId: string): string {
  return handles.get(sessionId)?.startUrl ?? "bash";
}

export function setSessionPage(sessionId: string, page: Page): void {
  const handle = handles.get(sessionId);
  if (!handle) throw new SessionNotFoundError(sessionId);
  handle.page = page;
}

export async function closeSession(sessionId: string): Promise<Session> {
  const handle = handles.get(sessionId);
  try {
    if (handle) {
      if (handle.engine === "tui") {
        stopTuiRecording(sessionId);
      }
      for (const cleanup of handle.cleanups) {
        try { await cleanup(); } catch {}
      }
      if (handle.bunView) {
        try { await handle.bunView.close(); } catch {}
      } else if (isExtensionPage(handle.page)) {
        // Extension sessions are backed by the user's own Chrome tab. Closing
        // the SDK session must not close that real browser context.
      } else if (handle.tuiSession) {
        // TUI cleanup is handled via cleanups array (closeTui)
      } else {
        try { await handle.page.context().close(); } catch {}
        try { if (handle.browser) pool.release(handle.browser); } catch {}
      }
    }

    // Clean up per-session in-memory caches to prevent leaks
    try { const { clearLastSnapshot, clearSessionRefs } = await import("./snapshot.js"); clearLastSnapshot(sessionId); clearSessionRefs(sessionId); } catch {}
    try { const { stopAllWatchesForSession } = await import("./actions.js"); stopAllWatchesForSession(sessionId); } catch {}
    try { const { clearDialogs } = await import("./dialogs.js"); clearDialogs(sessionId); } catch {}
  } finally {
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
  await pool.destroyAll();
}

export { pool as browserPool };

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

// ─── Auto-reuse: find existing active session for an agent ───────────────────

export function getActiveSessionForAgent(agentId: string): CreateSessionResult | null {
  const session = dbGetActiveSessionForAgent(agentId);
  if (!session) return null;
  const handle = handles.get(session.id);
  if (!handle) return null;
  // Verify page is still alive
  try {
    if (handle.bunView) void handle.bunView.url();
    else if (isExtensionPage(handle.page)) handle.page.url();
    else handle.page.url();
  } catch {
    handles.delete(session.id);
    return null;
  }
  return { session, page: handle.page };
}

// ─── Auto-select: return single active session or null ──────────────────────

export function getDefaultSession(): CreateSessionResult | null {
  const session = dbGetDefaultActiveSession();
  if (!session) return null;
  const handle = handles.get(session.id);
  if (!handle) return null;
  try {
    if (handle.bunView) void handle.bunView.url();
    else if (isExtensionPage(handle.page)) handle.page.url();
    else handle.page.url();
  } catch {
    handles.delete(session.id);
    return null;
  }
  return { session, page: handle.page };
}

export function isAutoGallery(sessionId: string): boolean {
  return handles.get(sessionId)?.autoGallery ?? false;
}

export function countActiveSessions(): number {
  return dbCountActiveSessions();
}
