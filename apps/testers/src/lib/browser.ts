import { chromium, type Browser, type Page } from "playwright";
import { execSync } from "node:child_process";
import { BrowserError } from "../types/index.js";

export type BrowserEngine = "playwright" | "lightpanda";

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

  // Default: Playwright
  const headless = options?.headless ?? true;
  const viewport = options?.viewport ?? DEFAULT_VIEWPORT;

  try {
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
 * Installs Chromium for Playwright using bunx.
 */
export async function installBrowser(engine?: BrowserEngine): Promise<void> {
  if (engine === "lightpanda") {
    const { installLightpanda } = await import("./browser-lightpanda.js");
    return installLightpanda();
  }

  try {
    execSync("bunx playwright install chromium", {
      stdio: "inherit",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(`Failed to install browser: ${message}`);
  }
}
