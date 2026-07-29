import type { Browser, Page } from "playwright";
import type { Session, SessionOptions, SessionStatus } from "../types/index.js";
import { BrowserEngine, UseCase } from "../types/index.js";
import { SessionNotFoundError, BrowserError } from "../types/index.js";
import { createSession as dbCreateSession, getSession as dbGetSession, listSessions as dbListSessions, closeSession as dbCloseSession, updateSessionStatus, getSessionByName as dbGetSessionByName, renameSession as dbRenameSession, getActiveSessionForAgent as dbGetActiveSessionForAgent, getDefaultActiveSession as dbGetDefaultActiveSession, countActiveSessions as dbCountActiveSessions } from "../db/sessions.js";
import { getPage as getPlaywrightPage, BrowserPool } from "../engines/playwright.js";
import { connectLightpanda } from "../engines/lightpanda.js";
import { BunWebViewSession, isBunWebViewAvailable } from "../engines/bun-webview.js";
import { resolveEnginePreference, selectEngine } from "../engines/selector.js";
import { launchTui, closeTui, type TuiSession } from "../engines/tui.js";
import { createExtensionPage, isExtensionPage } from "../engines/extension.js";
import { stopTuiRecording } from "./tui-recording.js";
import { enableNetworkLogging } from "./network.js";
import { enableConsoleCapture } from "./console.js";
import { applyStealthPatches } from "./stealth.js";
import { setupDialogHandler } from "./dialogs.js";
import { assertBrowserCapability, assertBrowserNavigationAllowed } from "./policy.js";
import { sqliteTimestampCutoff } from "./security.js";

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
      const cutoff = sqliteTimestampCutoff(DB_RETENTION_HOURS);
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

async function attachRemoteBrowserSession(
  browser: Browser,
  opts: SessionOptions,
  config: {
    engine: BrowserEngine;
    name: string;
    cleanup?: () => void | Promise<void>;
    remoteSessionId?: string;
    persistenceId?: string;
    browserLiveViewUrl?: string;
    deferListeners?: boolean;
  },
): Promise<CreateSessionResult> {
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  const session = dbCreateSession({
    engine: config.engine,
    projectId: opts.projectId,
    agentId: opts.agentId,
    startUrl: opts.startUrl ?? page.url(),
    name: opts.name ?? config.name,
    remoteSessionId: config.remoteSessionId,
    persistenceId: config.persistenceId,
    browserLiveViewUrl: config.browserLiveViewUrl,
  });

  const cleanups: Array<() => void | Promise<void>> = [];
  if (config.cleanup) cleanups.push(config.cleanup);
  if (!config.deferListeners) {
    attachPlaywrightListeners(page, session.id, cleanups, {
      captureNetwork: opts.captureNetwork,
      captureConsole: opts.captureConsole,
    });
  }

  handles.set(session.id, {
    browser,
    bunView: null,
    tuiSession: null,
    page,
    engine: config.engine,
    cleanups,
    tokenBudget: { total: 0, used: 0 },
    lastActivity: Date.now(),
    autoGallery: opts.autoGallery ?? false,
    startUrl: opts.startUrl ?? "",
  });

  return { session, page };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CreateSessionResult {
  session: Session;
  page: Page;
}

export async function createSession(opts: SessionOptions = {}): Promise<CreateSessionResult> {
  // CDP attach: connect to existing browser
  if (opts.cdpUrl) {
    assertBrowserCapability("cdp_attach", { approvalToken: opts.approvalToken });
    const { connectToExistingBrowser } = await import("../engines/cdp.js");
    const cdpBrowser = await connectToExistingBrowser(opts.cdpUrl);
    return attachRemoteBrowserSession(cdpBrowser, opts, { engine: "cdp", name: "attached" });
  }

  const requestedEngine = resolveEnginePreference(opts.engine);
  const engine = requestedEngine === "auto" || !requestedEngine
    ? selectEngine(opts.useCase ?? UseCase.SPA_NAVIGATE, requestedEngine)
    : requestedEngine;

  const resolvedEngine: BrowserEngine = engine === "auto" ? "playwright" : engine;
  if (opts.startUrl) assertBrowserNavigationAllowed(opts.startUrl);
  if (opts.storageState) assertBrowserCapability("storage_state", { approvalToken: opts.approvalToken });

  let browser: Browser | null = null;
  let bunView: BunWebViewSession | null = null;
  let page: Page;
  let actualEngine: BrowserEngine = resolvedEngine;

  if (resolvedEngine === "kernel") {
    const { connectKernelBrowser, autofillLoginFromVault } = await import("../engines/kernel.js");
    const kernelBrowser = await connectKernelBrowser({
      projectId: opts.kernelProjectId,
      baseUrl: opts.kernelBaseUrl,
      requestTimeoutMs: opts.kernelRequestTimeoutMs,
      startUrl: opts.startUrl,
      name: opts.name,
      headless: opts.headless ?? true,
      stealth: opts.stealth,
      viewport: opts.viewport,
      timeoutSeconds: opts.kernelTimeoutSeconds,
      persistenceId: opts.kernelPersistenceId,
      profileId: opts.kernelProfileId,
      profileName: opts.kernelProfileName,
      saveProfileChanges: opts.kernelSaveProfileChanges,
      proxyId: opts.kernelProxyId,
      gpu: opts.kernelGpu,
      kioskMode: opts.kernelKioskMode,
      tags: opts.kernelTags,
      telemetry: opts.kernelTelemetry,
      chromePolicy: opts.kernelChromePolicy,
      env: opts.kernelEnv,
      envSecrets: opts.kernelEnvSecrets,
      authMode: opts.kernelAuthMode,
      approvalToken: opts.approvalToken,
    });
    try {
      const shouldAutofill = Boolean(opts.startUrl && (opts.kernelAuthMode === "cdp_autofill" || kernelBrowser.metadata.authFallback === "cdp_autofill"));
      const result = await attachRemoteBrowserSession(kernelBrowser.browser, opts, {
        engine: "kernel",
        name: kernelBrowser.metadata.persistenceId ?? "kernel",
        cleanup: kernelBrowser.close,
        remoteSessionId: kernelBrowser.metadata.sessionId,
        persistenceId: kernelBrowser.metadata.persistenceId,
        browserLiveViewUrl: kernelBrowser.metadata.browserLiveViewUrl,
        deferListeners: shouldAutofill,
      });
      if (opts.startUrl) {
        await result.page.goto(opts.startUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      }
      if (shouldAutofill && opts.startUrl) {
        await autofillLoginFromVault(result.page, opts.startUrl).catch(() => false);
        const handle = handles.get(result.session.id);
        if (handle) {
          attachPlaywrightListeners(result.page, result.session.id, handle.cleanups, {
            captureNetwork: opts.captureNetwork,
            captureConsole: opts.captureConsole,
          });
        }
      }
      return result;
    } catch (err) {
      await kernelBrowser.close().catch(() => {});
      throw err;
    }
  } else if (resolvedEngine === "bun") {
    if (!isBunWebViewAvailable()) {
      console.warn("[browser] Bun.WebView requested but not available — falling back to playwright. Run: bun upgrade --canary");
      actualEngine = "playwright";
      browser = await pool.acquire(opts.headless ?? true);
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
        browser = await pool.acquire(opts.headless ?? true);
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
    assertBrowserCapability("tui_launch", { approvalToken: opts.approvalToken });
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
    assertBrowserCapability("extension_session", { approvalToken: opts.approvalToken });
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
      tokenId: opts.extensionTokenId,
      approvalToken: opts.approvalToken,
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
      const { loadState } = await import("./storage-state.js");
      const state = loadState(opts.storageState);
      if (!state) {
        // Silently proceeding unauthenticated would make callers believe they
        // are testing a logged-in page when they are not — fail loudly instead.
        throw new BrowserError(
          `Storage state '${opts.storageState}' not found. Save one first (browser login --save-as, or browser session save-state) or check: browser session list-states`,
          "BROWSER_STORAGE_STATE_NOT_FOUND",
        );
      }
      const context = await browser.newContext({
        viewport: opts.viewport ?? { width: 1280, height: 720 },
        userAgent: opts.userAgent,
        storageState: state,
      });
      page = await context.newPage();
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
  if (handle.tuiSession) {
    handle.tuiSession.page = page;
  }
}

export async function closeSession(sessionId: string): Promise<Session> {
  const handle = handles.get(sessionId);
  try {
    if (handle) {
      if (handle.engine === "tui") {
        stopTuiRecording(sessionId);
      }
      try {
        const { stopAllVideoRecordingsForSession } = await import("./video-recording.js");
        await stopAllVideoRecordingsForSession(sessionId);
      } catch {}
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
      } else if (handle.engine === "cdp" || handle.engine === "kernel") {
        try { await handle.page.context().close(); } catch {}
        try { await handle.browser?.close(); } catch {}
      } else {
        try { await handle.page.context().close(); } catch {}
        try { if (handle.browser) pool.release(handle.browser); } catch {}
      }
    }

    // Clean up per-session in-memory caches to prevent leaks
    try { const { clearLastSnapshot, clearSessionRefs } = await import("./snapshot.js"); clearLastSnapshot(sessionId); clearSessionRefs(sessionId); } catch {}
    try { const { clearCachedSemanticActions } = await import("./semantic-actions.js"); clearCachedSemanticActions(sessionId); } catch {}
    try { const { clearDialogs } = await import("./dialogs.js"); clearDialogs(sessionId); } catch {}
  } finally {
    handles.delete(sessionId);
  }

  return dbCloseSession(sessionId);
}

export function getSession(sessionId: string): Session {
  return dbGetSession(sessionId);
}

export function resolveKernelRemoteSessionId(sessionIdOrRemoteId: string): string {
  try {
    const session = dbGetSession(sessionIdOrRemoteId);
    if (session.engine === "kernel" && session.remote_session_id) return session.remote_session_id;
  } catch {}
  return sessionIdOrRemoteId;
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
