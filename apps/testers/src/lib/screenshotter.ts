import type { Page } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert arbitrary text to a URL/filesystem-safe slug.
 * Lowercases, replaces non-alphanumeric runs with a single hyphen, trims
 * leading/trailing hyphens.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build a zero-padded screenshot filename.
 * Example: stepNumber=1, action="Navigate homepage" → "001-navigate-homepage.png"
 */
export function generateFilename(
  stepNumber: number,
  action: string,
): string {
  const padded = String(stepNumber).padStart(3, "0");
  const slug = slugify(action);
  return `${padded}-${slug}.png`;
}

/**
 * Derive the directory path for a specific scenario inside a run.
 * Layout: `<baseDir>/<runId>/<scenarioSlug>/`
 */
export function getScreenshotDir(
  baseDir: string,
  runId: string,
  scenarioSlug: string,
): string {
  return join(baseDir, runId, scenarioSlug);
}

/**
 * Create `dirPath` (and any parents) if it does not already exist.
 */
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScreenshotterOptions {
  baseDir?: string;
  format?: "png" | "jpeg";
  quality?: number;
  fullPage?: boolean;
}

interface CaptureOptions {
  runId: string;
  scenarioSlug: string;
  stepNumber: number;
  action: string;
}

interface CaptureResult {
  filePath: string;
  width: number;
  height: number;
  timestamp: string;
}

// ─── Class ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE_DIR = join(homedir(), ".testers", "screenshots");

export class Screenshotter {
  private readonly baseDir: string;
  private readonly format: "png" | "jpeg";
  private readonly quality: number;
  private readonly fullPage: boolean;

  constructor(options: ScreenshotterOptions = {}) {
    this.baseDir = options.baseDir ?? DEFAULT_BASE_DIR;
    this.format = options.format ?? "png";
    this.quality = options.quality ?? 90;
    this.fullPage = options.fullPage ?? false;
  }

  /**
   * Capture a screenshot of the current page state.
   */
  async capture(
    page: Page,
    options: CaptureOptions,
  ): Promise<CaptureResult> {
    const dir = getScreenshotDir(
      this.baseDir,
      options.runId,
      options.scenarioSlug,
    );
    const filename = generateFilename(options.stepNumber, options.action);
    const filePath = join(dir, filename);

    ensureDir(dir);

    await page.screenshot({
      path: filePath,
      fullPage: this.fullPage,
      type: this.format,
      quality: this.format === "jpeg" ? this.quality : undefined,
    });

    const viewport = page.viewportSize() ?? { width: 0, height: 0 };

    return {
      filePath,
      width: viewport.width,
      height: viewport.height,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Capture a full-page screenshot regardless of the instance default.
   */
  async captureFullPage(
    page: Page,
    options: CaptureOptions,
  ): Promise<CaptureResult> {
    const dir = getScreenshotDir(
      this.baseDir,
      options.runId,
      options.scenarioSlug,
    );
    const filename = generateFilename(options.stepNumber, options.action);
    const filePath = join(dir, filename);

    ensureDir(dir);

    await page.screenshot({
      path: filePath,
      fullPage: true,
      type: this.format,
      quality: this.format === "jpeg" ? this.quality : undefined,
    });

    const viewport = page.viewportSize() ?? { width: 0, height: 0 };

    return {
      filePath,
      width: viewport.width,
      height: viewport.height,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Capture a screenshot of a specific element identified by `selector`.
   */
  async captureElement(
    page: Page,
    selector: string,
    options: CaptureOptions,
  ): Promise<CaptureResult> {
    const dir = getScreenshotDir(
      this.baseDir,
      options.runId,
      options.scenarioSlug,
    );
    const filename = generateFilename(options.stepNumber, options.action);
    const filePath = join(dir, filename);

    ensureDir(dir);

    await page.locator(selector).screenshot({
      path: filePath,
      type: this.format,
      quality: this.format === "jpeg" ? this.quality : undefined,
    });

    const viewport = page.viewportSize() ?? { width: 0, height: 0 };

    return {
      filePath,
      width: viewport.width,
      height: viewport.height,
      timestamp: new Date().toISOString(),
    };
  }
}
