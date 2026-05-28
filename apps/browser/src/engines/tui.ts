import { execSync, spawn, type ChildProcess } from "node:child_process";
import type { Browser, Page } from "playwright";
import { BrowserError } from "../types/index.js";
import { launchPlaywright, getPage as getPlaywrightPage } from "./playwright.js";

// ─── TUI Engine ─────────────────────────────────────────────────────────────
// Launches a terminal app via ttyd (terminal-in-browser), then connects
// Playwright to the ttyd web UI. This gives full screenshot, click, and
// keystroke support for any TUI app (Ink, Blessed, Bubbletea, etc.).
//
// The transport remains ttyd, but reading can happen via two methods:
// - "buffer": xterm.js buffer introspection (current behavior)
// - "dom": xterm.js DOM row extraction (closer to DOM/a11y-style automation)

const DEFAULT_TTYD_PORT_START = 7780;
let nextPort = DEFAULT_TTYD_PORT_START;

// ─── Hard timeouts (all in ms) ───────────────────────────────────────────────
const DEFAULT_TOOL_TIMEOUT_MS = 15_000;
const HEALTH_CHECK_TIMEOUT_MS = 3_000;

export type TuiTheme = "dark" | "light" | "system";
export type TuiReadMethod = "buffer" | "dom";

export interface TuiRowRef {
  row: number;
  text: string;
  visible: boolean;
  selector?: string;
}

export interface TuiState {
  method: TuiReadMethod;
  text: string;
  rows: string[];
  row_count: number;
  cols: number | null;
  total_rows: number;
  buffer_length: number | null;
  cursor_row: number;
  cursor_col: number;
  font_size: number | null;
  theme: "dark" | "light";
  refs: Record<string, TuiRowRef>;
}

export interface TuiSession {
  ttydProcess: ChildProcess;
  port: number;
  browser: Browser;
  page: Page;
  theme: TuiTheme;
  method: TuiReadMethod;
  lastHealthCheck: number;   // Date.now() of last successful health check
  reconnectCount: number;    // How many times we've auto-reconnected
}

export type TuiHealthStatus =
  | { healthy: true; latency_ms: number }
  | { healthy: false; reason: string };

// xterm.js theme presets
const THEMES = {
  dark: {
    background: "#1e1e1e",
    foreground: "#d4d4d4",
    cursor: "#d4d4d4",
    selectionBackground: "#264f78",
    black: "#1e1e1e",
    red: "#f44747",
    green: "#6a9955",
    yellow: "#d7ba7d",
    blue: "#569cd6",
    magenta: "#c586c0",
    cyan: "#4ec9b0",
    white: "#d4d4d4",
    brightBlack: "#808080",
    brightRed: "#f44747",
    brightGreen: "#6a9955",
    brightYellow: "#d7ba7d",
    brightBlue: "#569cd6",
    brightMagenta: "#c586c0",
    brightCyan: "#4ec9b0",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#ffffff",
    foreground: "#1e1e1e",
    cursor: "#1e1e1e",
    selectionBackground: "#add6ff",
    black: "#1e1e1e",
    red: "#cd3131",
    green: "#008000",
    yellow: "#795e26",
    blue: "#0451a5",
    magenta: "#af00db",
    cyan: "#0598bc",
    white: "#d4d4d4",
    brightBlack: "#808080",
    brightRed: "#cd3131",
    brightGreen: "#008000",
    brightYellow: "#795e26",
    brightBlue: "#0451a5",
    brightMagenta: "#af00db",
    brightCyan: "#0598bc",
    brightWhite: "#ffffff",
  },
};

function normalizeRowText(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\s+$/g, "");
}

function buildRowRefs(
  rows: string[],
  method: TuiReadMethod,
  totalRows: number,
  rowCount: number,
): Record<string, TuiRowRef> {
  const refs: Record<string, TuiRowRef> = {};
  const firstVisibleRow = method === "buffer" ? Math.max(0, rowCount - totalRows) : 0;

  rows.forEach((text, index) => {
    refs[`@r${index}`] = {
      row: index,
      text,
      visible: method === "dom" ? true : index >= firstVisibleRow,
      selector: method === "dom" ? `#takumi-tui-dom-root .takumi-tui-dom-row[data-row="${index}"]` : undefined,
    };
  });

  return refs;
}

const DOM_RENDERER_ROOT_ID = "takumi-tui-dom-root";
const DOM_RENDERER_STYLE_ID = "takumi-tui-dom-style";

async function configureDomRenderer(
  page: Page,
  options: { active: boolean; theme: "dark" | "light"; fontSize?: number },
): Promise<void> {
  await page.evaluate((opts) => {
    const runtimeKey = "__takumiTuiDomRenderer";
    const rootId = "takumi-tui-dom-root";
    const styleId = "takumi-tui-dom-style";

    const win = window as any;

    const ensureStyle = () => {
      let style = document.getElementById(styleId) as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement("style");
        style.id = styleId;
        document.head.appendChild(style);
      }
      style.textContent = `
        #${rootId} {
          position: absolute;
          inset: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          white-space: pre;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          line-height: 1.2;
          background: var(--takumi-tui-bg, #1e1e1e);
          color: var(--takumi-tui-fg, #d4d4d4);
          z-index: 4;
          pointer-events: none;
          user-select: text;
        }
        #${rootId}[data-active="0"] {
          display: none;
        }
        #${rootId} .takumi-tui-dom-row {
          display: flex;
          min-height: 1.2em;
        }
        #${rootId} .takumi-tui-dom-cell {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 0.62em;
          height: 1.2em;
        }
        #${rootId} .takumi-tui-dom-cell[data-cursor="true"] {
          outline: 1px solid currentColor;
          outline-offset: -1px;
        }
        body[data-takumi-dom-render="1"] .xterm-rows,
        body[data-takumi-dom-render="1"] .xterm-text-layer,
        body[data-takumi-dom-render="1"] .xterm-cursor-layer,
        body[data-takumi-dom-render="1"] .xterm-selection-layer {
          opacity: 0 !important;
        }
      `;
    };

    const ensureRoot = () => {
      let root = document.getElementById(rootId) as HTMLDivElement | null;
      if (!root) {
        root = document.createElement("div");
        root.id = rootId;
        root.setAttribute("role", "grid");
        root.setAttribute("aria-label", "Terminal DOM renderer");
        const host = (document.getElementById("terminal-container") as HTMLElement | null)
          ?? (document.querySelector(".xterm") as HTMLElement | null)
          ?? document.body;
        if (getComputedStyle(host).position === "static") {
          host.style.position = "relative";
        }
        host.appendChild(root);
      }
      root.style.setProperty("--takumi-tui-bg", opts.theme === "light" ? "#ffffff" : "#1e1e1e");
      root.style.setProperty("--takumi-tui-fg", opts.theme === "light" ? "#1e1e1e" : "#d4d4d4");
      root.style.fontSize = `${opts.fontSize ?? 14}px`;
      root.dataset.active = opts.active ? "1" : "0";
      if (opts.active) root.removeAttribute("aria-hidden");
      else root.setAttribute("aria-hidden", "true");
      document.body.dataset.takumiDomRender = opts.active ? "1" : "0";
      return root;
    };

    const readCellChars = (line: any, col: number) => {
      try {
        const cell = typeof line?.getCell === "function" ? line.getCell(col) : null;
        const chars = typeof cell?.getChars === "function" ? cell.getChars() : "";
        if (chars) return chars;
      } catch {}
      try {
        const text = typeof line?.translateToString === "function" ? line.translateToString(false, col, col + 1) : "";
        if (text) return text;
      } catch {}
      return " ";
    };

    const buildState = (activeOnly: boolean) => {
      const term = win.term ?? win.terminal;
      if (!term?.buffer?.active) {
        return {
          text: "",
          rows: [] as string[],
          row_count: 0,
          cols: null,
          total_rows: 0,
          buffer_length: null,
          cursor_row: -1,
          cursor_col: -1,
          font_size: null,
          theme: opts.theme,
        };
      }

      const buf = term.buffer.active;
      const rows: string[] = [];
      const root = ensureRoot();
      const fragment = document.createDocumentFragment();

      for (let row = 0; row < buf.length; row++) {
        const line = buf.getLine(row);
        if (!line) continue;

        const rowEl = document.createElement("div");
        rowEl.className = "takumi-tui-dom-row";
        rowEl.setAttribute("role", "row");
        rowEl.dataset.row = String(row);
        rowEl.setAttribute("aria-rowindex", String(row + 1));

        let rowText = "";
        for (let col = 0; col < term.cols; col++) {
          const char = readCellChars(line, col) || " ";
          rowText += char;

          const cellEl = document.createElement("span");
          cellEl.className = "takumi-tui-dom-cell";
          cellEl.setAttribute("role", "gridcell");
          cellEl.dataset.row = String(row);
          cellEl.dataset.col = String(col);
          cellEl.setAttribute("aria-colindex", String(col + 1));
          cellEl.textContent = char;
          if (buf.cursorY === row && buf.cursorX === col) {
            cellEl.dataset.cursor = "true";
          }
          rowEl.appendChild(cellEl);
        }

        rows.push(rowText.replace(/\s+$/g, ""));
        rowEl.setAttribute("aria-label", rows[rows.length - 1] || " ");
        fragment.appendChild(rowEl);
      }

      root.replaceChildren(fragment);
      root.setAttribute("aria-rowcount", String(rows.length));
      root.dataset.method = "dom";

      return {
        text: rows.join("\n").trimEnd(),
        rows,
        row_count: rows.length,
        cols: term.cols,
        total_rows: term.rows,
        buffer_length: buf.length,
        cursor_row: buf.cursorY,
        cursor_col: buf.cursorX,
        font_size: term.options?.fontSize ?? null,
        theme: term.options?.theme?.background === "#ffffff" ? "light" as const : "dark" as const,
      };
    };

    ensureStyle();
    ensureRoot();

    if (!win[runtimeKey]) {
      win[runtimeKey] = {
        sync: () => buildState(false),
        activate: (active: boolean) => {
          const root = ensureRoot();
          root.dataset.active = active ? "1" : "0";
          if (active) root.removeAttribute("aria-hidden");
          else root.setAttribute("aria-hidden", "true");
          document.body.dataset.takumiDomRender = active ? "1" : "0";
        },
      };
      const intervalId = window.setInterval(() => {
        try {
          win[runtimeKey]?.sync?.();
        } catch {}
      }, 50);
      win[runtimeKey].intervalId = intervalId;
    }

    win[runtimeKey].activate(opts.active);
    win[runtimeKey].sync();
  }, options);
}

async function destroyDomRenderer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runtimeKey = "__takumiTuiDomRenderer";
    const win = window as any;
    if (win[runtimeKey]?.intervalId) {
      clearInterval(win[runtimeKey].intervalId);
    }
    delete win[runtimeKey];
    document.getElementById("takumi-tui-dom-root")?.remove();
    document.getElementById("takumi-tui-dom-style")?.remove();
    delete document.body.dataset.takumiDomRender;
  }).catch(() => {});
}

async function readDomMirrorState(page: Page): Promise<Omit<TuiState, "method" | "refs">> {
  return page.evaluate(() => {
    const runtime = (window as any).__takumiTuiDomRenderer;
    if (runtime?.sync) return runtime.sync();

    const rowEls = Array.from(document.querySelectorAll("#takumi-tui-dom-root .takumi-tui-dom-row")) as HTMLElement[];
    const rows = rowEls.map((row) => row.getAttribute("aria-label") ?? row.textContent ?? "");
    const term = (window as any).term ?? (window as any).terminal;
    const active = term?.buffer?.active;

    return {
      text: rows.join("\n").trimEnd(),
      rows,
      row_count: rows.length,
      cols: term?.cols ?? null,
      total_rows: term?.rows ?? rows.length,
      buffer_length: active?.length ?? rows.length,
      cursor_row: active?.cursorY ?? -1,
      cursor_col: active?.cursorX ?? -1,
      font_size: term?.options?.fontSize ?? null,
      theme: term?.options?.theme?.background === "#ffffff" ? "light" as const : "dark" as const,
    };
  });
}

function isDomMethod(method: TuiReadMethod | undefined): method is "dom" {
  return method === "dom";
}

function getRootSelector() {
  return `#${DOM_RENDERER_ROOT_ID}`;
}

function getStyleSelector() {
  return `#${DOM_RENDERER_STYLE_ID}`;
}

function toResolvedTheme(theme: TuiTheme, fallback: "dark" | "light"): "dark" | "light" {
  if (theme === "dark" || theme === "light") return theme;
  return fallback;
}

function getDomRowSelector(index: number) {
  return `${getRootSelector()} [data-row="${index}"]`;
}

function getDomCellSelector(row: number, col: number) {
  return `${getRootSelector()} [data-row="${row}"] [data-col="${col}"]`;
}

function getDomThemeColors(theme: "dark" | "light") {
  return THEMES[theme];
}

function getDomRendererInfo(method: TuiReadMethod) {
  return {
    rootSelector: getRootSelector(),
    styleSelector: getStyleSelector(),
    method,
  };
}

function getVisibleStart(totalRows: number, rowCount: number) {
  return Math.max(0, rowCount - totalRows);
}

function isVisibleBufferRow(index: number, totalRows: number, rowCount: number) {
  return index >= getVisibleStart(totalRows, rowCount);
}

function getDomRefSelector(index: number) {
  return getDomRowSelector(index);
}

function getDomRendererMeta(method: TuiReadMethod) {
  return getDomRendererInfo(method);
}

function getRendererRootId() {
  return DOM_RENDERER_ROOT_ID;
}

function getRendererStyleId() {
  return DOM_RENDERER_STYLE_ID;
}

function getRendererSelectors() {
  return {
    root: getRootSelector(),
    style: getStyleSelector(),
  };
}

function getDomRendererSelectors() {
  return getRendererSelectors();
}

function getDomRendererRowSelector(index: number) {
  return getDomRefSelector(index);
}

function getDomRendererCellSelector(row: number, col: number) {
  return getDomCellSelector(row, col);
}

function getDomRendererColors(theme: "dark" | "light") {
  return getDomThemeColors(theme);
}

function getBufferRowVisibility(index: number, totalRows: number, rowCount: number) {
  return isVisibleBufferRow(index, totalRows, rowCount);
}

function getResolvedTheme(theme: TuiTheme, fallback: "dark" | "light") {
  return toResolvedTheme(theme, fallback);
}

function getDomRendererSetup(method: TuiReadMethod) {
  return getDomRendererMeta(method);
}

function getDomRendererRef(index: number) {
  return getDomRefSelector(index);
}

function getDomRendererCellRef(row: number, col: number) {
  return getDomCellSelector(row, col);
}

function getBufferFirstVisibleRow(totalRows: number, rowCount: number) {
  return getVisibleStart(totalRows, rowCount);
}

function getBufferRowIsVisible(index: number, totalRows: number, rowCount: number) {
  return getBufferRowVisibility(index, totalRows, rowCount);
}

function getDomRendererTheme(theme: "dark" | "light") {
  return getDomRendererColors(theme);
}

function getDomRendererActivation(method: TuiReadMethod) {
  return isDomMethod(method);
}

function getDomRendererSelection(index: number) {
  return getDomRendererRef(index);
}
// ─── Timeout wrapper ─────────────────────────────────────────────────────────

/**
 * Run an async operation with a hard timeout. If it doesn't complete in time,
 * throw a BrowserError instead of hanging.
 */
async function withTimeout<T>(
  label: string,
  operation: () => Promise<T>,
  timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new BrowserError(
        `${label} timed out after ${timeoutMs}ms — ttyd/playwright connection may be unhealthy. Try closing and re-opening the session.`,
        "TUI_TIMEOUT"
      ));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ─── Health check ────────────────────────────────────────────────────────────

/**
 * Probe the ttyd page with a cheap evaluate call to determine if the connection
 * is still alive. Returns within HEALTH_CHECK_TIMEOUT_MS.
 */
export async function isTuiHealthy(session: TuiSession): Promise<TuiHealthStatus> {
  const start = Date.now();
  try {
    await Promise.race([
      session.page.evaluate(() => {
        const term = (window as any).term ?? (window as any).terminal;
        if (!term) return false;
        if (!term.buffer?.active) return false;
        return true;
      }),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error("health check timeout")), HEALTH_CHECK_TIMEOUT_MS)
      ),
    ]);
    const latency = Date.now() - start;
    return { healthy: true, latency_ms: latency };
  } catch (err: any) {
    return { healthy: false, reason: err?.message ?? "unreachable" };
  }
}

// ─── Auto-recovery ───────────────────────────────────────────────────────────

/**
 * Attempt to reconnect to a stuck ttyd session. Kills the old process, restarts
 * ttyd on the same port, and re-attaches Playwright. Returns a new TuiSession;
 * the old session is invalid after this call.
 */
export async function reconnectTui(
  session: TuiSession,
  command: string,
  options: {
    headless?: boolean;
    viewport?: { width: number; height: number };
    theme?: TuiTheme;
    fontSize?: number;
    method?: TuiReadMethod;
  } = {}
): Promise<TuiSession> {
  const port = session.port;

  try { session.ttydProcess.kill("SIGTERM"); } catch {}
  try { await session.page.close(); } catch {}
  try { await session.browser.close(); } catch {}

  const ttydProcess = spawn(
    "ttyd",
    ["--writable", "--port", String(port), "/bin/sh", "-c", command],
    { stdio: "ignore", detached: false }
  );
  ttydProcess.on("error", (err) => { console.error(`[tui] reconnect ttyd error: ${err.message}`); });

  await waitForTtyd(port);
  const viewport = options.viewport ?? { width: 1280, height: 720 };
  const browser = await launchPlaywright({ headless: options.headless ?? true, viewport });
  const page = await getPlaywrightPage(browser, { viewport });
  await page.goto(`http://localhost:${port}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".xterm-screen", { timeout: 10_000 });

  // Resolve "system" theme (same logic as launchTui)
  let resolvedTheme: "dark" | "light" = "dark";
  const req = options.theme ?? "dark";
  if (req === "light" || req === "dark") {
    resolvedTheme = req;
  } else {
    // "system" — detect OS preference
    try {
      const r = execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", { encoding: "utf8" }).trim();
      resolvedTheme = r === "Dark" ? "dark" : "light";
    } catch { resolvedTheme = "light"; }
  }
  const themeColors = THEMES[resolvedTheme];
  await page.evaluate((theme) => {
    const term = (window as any).term ?? (window as any).terminal;
    if (term?.options) term.options.theme = theme;
    document.body.style.backgroundColor = theme.background;
  }, themeColors);

  const method = options.method ?? session.method;
  await configureDomRenderer(page, {
    active: isDomMethod(method),
    theme: resolvedTheme,
    fontSize: options.fontSize,
  });

  return {
    ttydProcess,
    port,
    browser,
    page,
    theme: resolvedTheme,
    method,
    lastHealthCheck: Date.now(),
    reconnectCount: session.reconnectCount + 1,
  };
}

// ─── Session lifecycle helpers ───────────────────────────────────────────────

/**
 * Check if ttyd is installed on this system.
 */
export function isTuiAvailable(): boolean {
  try {
    execSync("which ttyd", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find an available port starting from the given port.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://localhost:${port}`);
      port++;
    } catch {
      return port;
    }
  }
  throw new BrowserError("No available port found for ttyd", "TUI_PORT_EXHAUSTED");
}

/**
 * Wait for ttyd to be ready by polling the HTTP endpoint.
 */
async function waitForTtyd(port: number, timeoutMs: number = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://localhost:${port}`);
      if (resp.ok || resp.status === 200) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new BrowserError(`ttyd did not start within ${timeoutMs}ms`, "TUI_TIMEOUT");
}

// ─── Launch ───────────────────────────────────────────────────────────────────

/**
 * Launch a terminal app via ttyd and connect Playwright to it.
 */
export async function launchTui(
  command: string,
  options: {
    headless?: boolean;
    viewport?: { width: number; height: number };
    theme?: TuiTheme;
    fontSize?: number;
    method?: TuiReadMethod;
  } = {}
): Promise<TuiSession> {
  if (!isTuiAvailable()) {
    throw new BrowserError("ttyd not found — install with: brew install ttyd", "TUI_NOT_AVAILABLE");
  }

  const port = await findAvailablePort(nextPort);
  nextPort = port + 1;

  const ttydProcess = spawn(
    "ttyd",
    ["--writable", "--port", String(port), "/bin/sh", "-c", command],
    { stdio: "ignore", detached: false }
  );
  ttydProcess.on("error", (err) => { console.error(`[tui] ttyd process error: ${err.message}`); });

  try {
    await waitForTtyd(port);

    const viewport = options.viewport ?? { width: 1280, height: 720 };
    const browser = await launchPlaywright({ headless: options.headless ?? true, viewport });
    const page = await getPlaywrightPage(browser, { viewport });
    await page.goto(`http://localhost:${port}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".xterm-screen", { timeout: 10_000 });

    let resolvedTheme: "dark" | "light" = "dark";
    const requestedTheme = options.theme ?? "system";
    if (requestedTheme === "light") {
      resolvedTheme = "light";
    } else if (requestedTheme === "dark") {
      resolvedTheme = "dark";
    } else {
      try {
        const result = execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", { encoding: "utf8" }).trim();
        resolvedTheme = result === "Dark" ? "dark" : "light";
      } catch {
        resolvedTheme = "light";
      }
    }

    const themeColors = THEMES[resolvedTheme];
    await page.evaluate((theme) => {
      const term = (window as any).term ?? (window as any).terminal;
      if (term?.options) term.options.theme = theme;
      document.body.style.backgroundColor = theme.background;
      const container = document.getElementById("terminal-container");
      if (container) container.style.backgroundColor = theme.background;
      const vp = document.querySelector(".xterm-viewport") as HTMLElement;
      if (vp) vp.style.backgroundColor = theme.background;
    }, themeColors);

    if (options.fontSize) {
      await page.evaluate((size: number) => {
        const term = (window as any).term ?? (window as any).terminal;
        if (term?.options) term.options.fontSize = size;
      }, options.fontSize);
    }

    const method = options.method ?? "buffer";
    await configureDomRenderer(page, {
      active: isDomMethod(method),
      theme: resolvedTheme,
      fontSize: options.fontSize,
    });

    return {
      ttydProcess,
      port,
      browser,
      page,
      theme: resolvedTheme,
      method,
      lastHealthCheck: Date.now(),
      reconnectCount: 0,
    };
  } catch (err) {
    try { ttydProcess.kill("SIGTERM"); } catch {}
    throw err;
  }
}

async function getBufferState(page: Page): Promise<Omit<TuiState, "method" | "refs">> {
  return page.evaluate(() => {
    const term = (window as any).term ?? (window as any).terminal;
    if (!term?.buffer?.active) {
      return {
        text: "",
        rows: [] as string[],
        row_count: 0,
        cols: null,
        total_rows: 0,
        buffer_length: null,
        cursor_row: -1,
        cursor_col: -1,
        font_size: null,
        theme: "dark" as const,
      };
    }

    const buf = term.buffer.active;
    const rows: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) rows.push(line.translateToString(true));
    }

    return {
      text: rows.join("\n").trimEnd(),
      rows,
      row_count: buf.length,
      cols: term.cols,
      total_rows: term.rows,
      buffer_length: buf.length,
      cursor_row: buf.cursorY,
      cursor_col: buf.cursorX,
      font_size: term.options?.fontSize ?? null,
      theme: term.options?.theme?.background === "#ffffff" ? "light" as const : "dark" as const,
    };
  });
}

async function getDomState(page: Page): Promise<Omit<TuiState, "method" | "refs">> {
  return readDomMirrorState(page);
}

export async function getTerminalState(
  page: Page,
  method: TuiReadMethod = "buffer",
  timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS,
): Promise<TuiState> {
  return withTimeout("getTerminalState", async () => {
    const raw = method === "dom" ? await getDomState(page) : await getBufferState(page);
    const rows = raw.rows.map(normalizeRowText);
    const text = rows.join("\n").trimEnd();

    return {
      ...raw,
      method,
      rows,
      text,
      refs: buildRowRefs(rows, method, raw.total_rows, raw.row_count),
    };
  }, timeoutMs);
}

// ─── Interaction helpers (all use hard timeouts) ──────────────────────────────

export async function sendKeys(
  page: Page,
  keys: string,
  timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS
): Promise<void> {
  await withTimeout("sendKeys", async () => {
    const terminal = await page.$(".xterm-helper-textarea");
    if (terminal) { await terminal.type(keys); }
    else { await page.keyboard.type(keys); }
  }, timeoutMs);
}

export async function sendSpecialKey(
  page: Page,
  key: string,
  timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS
): Promise<void> {
  await withTimeout("sendSpecialKey", async () => {
    const terminal = await page.$(".xterm-helper-textarea");
    if (terminal) { await terminal.press(key); }
    else { await page.keyboard.press(key); }
  }, timeoutMs);
}

export async function getTerminalText(
  page: Page,
  timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS,
  method: TuiReadMethod = "buffer",
): Promise<string> {
  const state = await getTerminalState(page, method, timeoutMs);
  return state.text;
}

/**
 * Wait for specific text to appear in the terminal output.
 * Per-poll health probe detects a stuck terminal early and returns stuck:true.
 */
export async function waitForTerminalText(
  page: Page,
  text: string,
  timeoutMs: number = 30_000,
  method: TuiReadMethod = "buffer",
): Promise<{ found: boolean; elapsed_ms: number; stuck: boolean }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    // Health probe — if this times out, the terminal is stuck
    let healthy = false;
    try {
      await Promise.race([
        page.evaluate(() => {
          const term = (window as any).term ?? (window as any).terminal;
          return term?.buffer?.active ? true : false;
        }),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error("probe timeout")), 2_000)
        ),
      ]);
      healthy = true;
    } catch { /* stuck */ }

    if (!healthy) return { found: false, elapsed_ms: Date.now() - start, stuck: true };

    const content = await getTerminalText(page, DEFAULT_TOOL_TIMEOUT_MS, method);
    if (content.includes(text)) return { found: true, elapsed_ms: Date.now() - start, stuck: false };
    await new Promise((r) => setTimeout(r, 250));
  }

  return { found: false, elapsed_ms: Date.now() - start, stuck: false };
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

export async function closeTui(session: TuiSession): Promise<void> {
  await destroyDomRenderer(session.page);
  try { await session.page.close(); } catch {}
  try { await session.browser.close(); } catch {}
  try { session.ttydProcess.kill("SIGTERM"); } catch {}
  try { session.ttydProcess.kill("SIGKILL"); } catch {}
}
