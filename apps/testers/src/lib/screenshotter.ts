import type { Page } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Helpers ────────────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateFilename(stepNumber: number, action: string): string {
  const padded = String(stepNumber).padStart(3, "0");
  const slug = slugify(action);
  return `${padded}_${slug}.png`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 19).replace(/:/g, "-"); // HH-mm-ss
}

/**
 * Build the screenshot directory for a run:
 * {baseDir}/{projectName}/{YYYY-MM-DD}/{HH-mm-ss}_{runId-8char}/{scenarioSlug}/
 */
export function getScreenshotDir(
  baseDir: string,
  runId: string,
  scenarioSlug: string,
  projectName?: string,
  timestamp?: Date,
): string {
  const now = timestamp ?? new Date();
  const project = projectName ?? "default";
  const dateDir = formatDate(now);
  const timeDir = `${formatTime(now)}_${runId.slice(0, 8)}`;
  return join(baseDir, project, dateDir, timeDir, scenarioSlug);
}

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
  projectName?: string;
}

interface CaptureOptions {
  runId: string;
  scenarioSlug: string;
  stepNumber: number;
  action: string;
  description?: string; // AI-provided descriptive name
}

export interface CaptureResult {
  filePath: string;
  width: number;
  height: number;
  timestamp: string;
  description: string | null;
  pageUrl: string | null;
  thumbnailPath: string | null;
}

// ─── Metadata ───────────────────────────────────────────────────────────────

interface ScreenshotMeta {
  stepNumber: number;
  action: string;
  description: string | null;
  pageUrl: string;
  viewport: { width: number; height: number };
  timestamp: string;
  filePath: string;
}

function writeMetaSidecar(screenshotPath: string, meta: ScreenshotMeta): void {
  const metaPath = screenshotPath.replace(/\.png$/, ".meta.json").replace(/\.jpeg$/, ".meta.json");
  try {
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    // Non-critical — don't fail the screenshot
  }
}

export function writeRunMeta(
  dir: string,
  meta: { runId: string; url: string; model: string; status: string; startedAt: string; scenarioCount: number },
): void {
  ensureDir(dir);
  try {
    writeFileSync(join(dir, "_run-meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    // Non-critical
  }
}

export function writeScenarioMeta(
  dir: string,
  meta: { scenarioId: string; shortId: string; name: string; status: string; reasoning: string | null; durationMs: number },
): void {
  ensureDir(dir);
  try {
    writeFileSync(join(dir, "_scenario-meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    // Non-critical
  }
}

// ─── Thumbnail ──────────────────────────────────────────────────────────────

async function generateThumbnail(
  page: Page,
  screenshotDir: string,
  filename: string,
): Promise<string | null> {
  try {
    const thumbDir = join(screenshotDir, "_thumbnail");
    ensureDir(thumbDir);
    const thumbFilename = filename.replace(/\.(png|jpeg)$/, ".thumb.$1");
    const thumbPath = join(thumbDir, thumbFilename);

    // Use Playwright to capture a smaller viewport screenshot for the thumbnail
    const viewport = page.viewportSize();
    if (viewport) {
      await page.screenshot({
        path: thumbPath,
        type: "png",
        clip: { x: 0, y: 0, width: Math.min(viewport.width, 1280), height: Math.min(viewport.height, 720) },
      });
    }
    return thumbPath;
  } catch {
    return null;
  }
}

// ─── Class ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE_DIR = join(homedir(), ".testers", "screenshots");

export class Screenshotter {
  private readonly baseDir: string;
  private readonly format: "png" | "jpeg";
  private readonly quality: number;
  private readonly fullPage: boolean;
  private readonly projectName: string;
  private runTimestamp: Date;

  constructor(options: ScreenshotterOptions = {}) {
    this.baseDir = options.baseDir ?? DEFAULT_BASE_DIR;
    this.format = options.format ?? "png";
    this.quality = options.quality ?? 90;
    this.fullPage = options.fullPage ?? false;
    this.projectName = options.projectName ?? "default";
    this.runTimestamp = new Date();
  }

  async capture(page: Page, options: CaptureOptions): Promise<CaptureResult> {
    const action = options.description ?? options.action;
    const dir = getScreenshotDir(
      this.baseDir,
      options.runId,
      options.scenarioSlug,
      this.projectName,
      this.runTimestamp,
    );
    const filename = generateFilename(options.stepNumber, action);
    const filePath = join(dir, filename);

    ensureDir(dir);

    const screenshotOpts: Record<string, unknown> = {
      path: filePath,
      fullPage: this.fullPage,
      type: this.format,
    };
    if (this.format === "jpeg") screenshotOpts.quality = this.quality;
    await page.screenshot(screenshotOpts);

    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    const pageUrl = page.url();
    const timestamp = new Date().toISOString();

    // Write metadata sidecar
    writeMetaSidecar(filePath, {
      stepNumber: options.stepNumber,
      action: options.action,
      description: options.description ?? null,
      pageUrl,
      viewport,
      timestamp,
      filePath,
    });

    // Generate thumbnail
    const thumbnailPath = await generateThumbnail(page, dir, filename);

    return {
      filePath,
      width: viewport.width,
      height: viewport.height,
      timestamp,
      description: options.description ?? null,
      pageUrl,
      thumbnailPath,
    };
  }

  async captureFullPage(page: Page, options: CaptureOptions): Promise<CaptureResult> {
    const action = options.description ?? options.action;
    const dir = getScreenshotDir(
      this.baseDir,
      options.runId,
      options.scenarioSlug,
      this.projectName,
      this.runTimestamp,
    );
    const filename = generateFilename(options.stepNumber, action);
    const filePath = join(dir, filename);

    ensureDir(dir);

    const ssOpts2: Record<string, unknown> = {
      path: filePath,
      fullPage: true,
      type: this.format,
    };
    if (this.format === "jpeg") ssOpts2.quality = this.quality;
    await page.screenshot(ssOpts2);

    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    const pageUrl = page.url();
    const timestamp = new Date().toISOString();

    writeMetaSidecar(filePath, {
      stepNumber: options.stepNumber,
      action: options.action,
      description: options.description ?? null,
      pageUrl,
      viewport,
      timestamp,
      filePath,
    });

    const thumbnailPath = await generateThumbnail(page, dir, filename);

    return {
      filePath,
      width: viewport.width,
      height: viewport.height,
      timestamp,
      description: options.description ?? null,
      pageUrl,
      thumbnailPath,
    };
  }

  async captureElement(page: Page, selector: string, options: CaptureOptions): Promise<CaptureResult> {
    const action = options.description ?? options.action;
    const dir = getScreenshotDir(
      this.baseDir,
      options.runId,
      options.scenarioSlug,
      this.projectName,
      this.runTimestamp,
    );
    const filename = generateFilename(options.stepNumber, action);
    const filePath = join(dir, filename);

    ensureDir(dir);

    const ssOpts3: Record<string, unknown> = {
      path: filePath,
      type: this.format,
    };
    if (this.format === "jpeg") ssOpts3.quality = this.quality;
    await page.locator(selector).screenshot(ssOpts3);

    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    const pageUrl = page.url();
    const timestamp = new Date().toISOString();

    writeMetaSidecar(filePath, {
      stepNumber: options.stepNumber,
      action: options.action,
      description: options.description ?? null,
      pageUrl,
      viewport,
      timestamp,
      filePath,
    });

    return {
      filePath,
      width: viewport.width,
      height: viewport.height,
      timestamp,
      description: options.description ?? null,
      pageUrl,
      thumbnailPath: null,
    };
  }
}
