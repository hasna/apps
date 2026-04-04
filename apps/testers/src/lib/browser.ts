import { chromium, firefox, webkit, type Browser, type Page } from "playwright";
import { execSync } from "node:child_process";
import { BrowserError } from "../types/index.js";

export type BrowserEngine = "playwright" | "playwright-firefox" | "playwright-webkit" | "lightpanda" | "bun";

interface ViewportSize {
  width: number;
  height: number;
}

interface LaunchOptions {
  headless?: boolean;
  viewport?: ViewportSize;
  engine?: BrowserEngine;
}

interface PageOptions {
  viewport?: ViewportSize;
  userAgent?: string;
  locale?: string;
}

interface PoolEntry {
  browser: Browser;
  inUse: boolean;
}

const DEFAULT_VIEWPORT: ViewportSize = { width: 1280, height: 720 };

/**
 * Launches a Chromium browser instance via Playwright.
 */
export async function launchBrowser(options?: LaunchOptions): Promise<Browser> {
  const engine = options?.engine ?? (process.env["TESTERS_BROWSER_ENGINE"] as BrowserEngine | undefined) ?? "playwright";

  if (engine === "lightpanda") {
    const { launchLightpanda, isLightpandaAvailable } = await import("./browser-lightpanda.js");
    if (!isLightpandaAvailable()) {
      throw new BrowserError("Lightpanda not installed. Run: testers install-browser --engine lightpanda");
    }
    return launchLightpanda({ viewport: options?.viewport });
  }

  if (engine === "bun") {
    // Bun.WebView: the session IS the page — wrap it in a Playwright-compatible shim
    const { isBunWebViewAvailable, BunWebViewSession } = await import("./browser-bun.js");
    if (!isBunWebViewAvailable()) {
      throw new BrowserError("Bun.WebView not available. Upgrade to Bun canary: bun upgrade --canary");
    }
    const session = new BunWebViewSession({
      width: options?.viewport?.width ?? 1280,
      height: options?.viewport?.height ?? 720,
    });
    // Return a minimal Browser-like shim — the page IS the session
    return {
      newContext: async () => ({ newPage: async () => session as unknown as Page, close: async () => {} }),
      close: async () => session.close(),
      contexts: () => [],
      _bunSession: session,  // attach so getPage can retrieve it
    } as unknown as Browser;
  }

  // Default: Playwright
  const headless = options?.headless ?? true;
  const viewport = options?.viewport ?? DEFAULT_VIEWPORT;

  try {
    if (engine === "playwright-firefox") {
      const browser = await firefox.launch({ headless });
      return browser;
    }

    if (engine === "playwright-webkit") {
      const browser = await webkit.launch({ headless });
      return browser;
    }

    // Default: chromium
    const browser = await chromium.launch({
      headless,
      args: [
        `--window-size=${viewport.width},${viewport.height}`,
      ],
    });
    return browser;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(`Failed to launch browser: ${message}`);
  }
}

/**
 * Creates a new page in the given browser with optional viewport,
 * user agent, and locale settings.
 */
export async function getPage(
  browser: Browser,
  options?: PageOptions & { engine?: BrowserEngine },
): Promise<Page> {
  const engine = options?.engine ?? "playwright";

  if (engine === "lightpanda") {
    const { getLightpandaPage } = await import("./browser-lightpanda.js");
    return getLightpandaPage(browser, options);
  }

  // Bun.WebView: the session was attached during launchBrowser — retrieve it directly
  if (engine === "bun") {
    const bunSession = (browser as unknown as { _bunSession: unknown })._bunSession;
    if (bunSession) return bunSession as unknown as Page;
    throw new BrowserError("Bun.WebView session not found on browser instance");
  }

  const viewport = options?.viewport ?? DEFAULT_VIEWPORT;

  try {
    const context = await browser.newContext({
      viewport,
      userAgent: options?.userAgent,
      locale: options?.locale,
    });
    const page = await context.newPage();
    return page;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(`Failed to create page: ${message}`);
  }
}

/**
 * Closes a browser instance gracefully.
 */
export async function closeBrowser(browser: Browser, engine?: BrowserEngine): Promise<void> {
  if (engine === "lightpanda") {
    const { closeLightpanda } = await import("./browser-lightpanda.js");
    return closeLightpanda(browser);
  }

  if (engine === "bun") {
    const bunSession = (browser as unknown as { _bunSession: { close(): Promise<void> } })._bunSession;
    if (bunSession) await bunSession.close();
    return;
  }

  try {
    await browser.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(`Failed to close browser: ${message}`);
  }
}

/**
 * A pool of reusable browser instances to avoid the overhead of
 * launching a new browser for every test scenario.
 */
export class BrowserPool {
  private readonly pool: PoolEntry[] = [];
  private readonly maxSize: number;
  private readonly headless: boolean;
  private readonly viewport: ViewportSize;

  private readonly engine: BrowserEngine;

  constructor(
    size: number,
    options?: { headless?: boolean; viewport?: ViewportSize; engine?: BrowserEngine },
  ) {
    this.maxSize = size;
    this.headless = options?.headless ?? true;
    this.viewport = options?.viewport ?? DEFAULT_VIEWPORT;
    this.engine = options?.engine ?? "playwright";
  }

  /**
   * Acquires a browser and page from the pool. Reuses an idle browser
   * if available, or launches a new one if the pool hasn't reached capacity.
   * Waits and retries if the pool is fully occupied.
   */
  async acquire(): Promise<{ browser: Browser; page: Page }> {
    // Try to reuse an idle browser
    const idle = this.pool.find((entry) => !entry.inUse);
    if (idle) {
      idle.inUse = true;
      const page = await getPage(idle.browser, { viewport: this.viewport, engine: this.engine });
      return { browser: idle.browser, page };
    }

    // Launch a new browser if under capacity
    if (this.pool.length < this.maxSize) {
      const browser = await launchBrowser({
        headless: this.headless,
        viewport: this.viewport,
        engine: this.engine,
      });
      const entry: PoolEntry = { browser, inUse: true };
      this.pool.push(entry);
      const page = await getPage(browser, { viewport: this.viewport, engine: this.engine });
      return { browser, page };
    }

    // Pool is full — wait for a browser to become available
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        const available = this.pool.find((entry) => !entry.inUse);
        if (available) {
          clearInterval(interval);
          available.inUse = true;
          getPage(available.browser, { viewport: this.viewport, engine: this.engine })
            .then((page) => resolve({ browser: available.browser, page }))
            .catch(reject);
        }
      }, 50);
    });
  }

  /**
   * Returns a browser to the pool, marking it as available.
   */
  release(browser: Browser): void {
    const entry = this.pool.find((e) => e.browser === browser);
    if (entry) {
      entry.inUse = false;
    }
  }

  /**
   * Closes all browsers in the pool and clears it.
   */
  async closeAll(): Promise<void> {
    const closePromises = this.pool.map((entry) =>
      entry.browser.close().catch(() => {
        // Swallow errors during cleanup
      }),
    );
    await Promise.all(closePromises);
    this.pool.length = 0;
  }
}

/**
 * A simple factory that launches the appropriate browser engine.
 * Use this as the single entry-point when you want engine-agnostic launch logic.
 */
export interface BrowserConfig {
  headless: boolean;
  viewport?: ViewportSize;
}

export async function launchBrowserEngine(
  engine: BrowserEngine,
  config: BrowserConfig,
): Promise<Browser> {
  if (engine === "lightpanda") {
    const { launchLightpanda, isLightpandaAvailable } = await import("./browser-lightpanda.js");
    if (!isLightpandaAvailable()) {
      throw new BrowserError("Lightpanda not installed. Run: testers install-browser --engine lightpanda");
    }
    return launchLightpanda({ viewport: config.viewport });
  }
  if (engine === "bun") {
    return launchBrowser({ headless: config.headless, viewport: config.viewport, engine: "bun" });
  }
  // Default: playwright chromium
  return chromium.launch({
    headless: config.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

/**
 * Installs Chromium for Playwright using bunx.
 */
export async function installBrowser(engine?: BrowserEngine): Promise<void> {
  if (engine === "lightpanda") {
    const { installLightpanda } = await import("./browser-lightpanda.js");
    return installLightpanda();
  }

  const browserName = engine === "playwright-firefox" ? "firefox" : engine === "playwright-webkit" ? "webkit" : "chromium";

  try {
    execSync(`bunx playwright install ${browserName}`, {
      stdio: "inherit",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(`Failed to install browser: ${message}`);
  }
}
