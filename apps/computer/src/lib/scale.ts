import { tmpdir } from "os";
import { join } from "path";
import { readFile, unlink, writeFile } from "fs/promises";
import type { Screenshot, ScreenSize } from "../types/index.js";

/**
 * Recommended max resolutions for AI models.
 * Anthropic docs say resolutions above XGA/WXGA hurt accuracy and speed.
 */
export const RECOMMENDED_WIDTHS = {
  /** XGA: 1024x768 (4:3) — most conservative, best for accuracy */
  xga: 1024,
  /** WXGA: 1280x800 (16:10) — good balance */
  wxga: 1280,
  /** HD: 1366x768 (16:9) — wider but still reasonable */
  hd: 1366,
} as const;

const DEFAULT_MAX_WIDTH = RECOMMENDED_WIDTHS.wxga; // 1280

/**
 * Scale a screenshot down if it exceeds maxWidth.
 * Uses macOS `sips` (built-in, zero dependencies).
 * Returns a new Screenshot with scaled base64 data and updated size.
 * If the screenshot is already smaller than maxWidth, returns it unchanged.
 */
export async function scaleScreenshot(
  screenshot: Screenshot,
  maxWidth: number = DEFAULT_MAX_WIDTH
): Promise<Screenshot> {
  // No scaling needed if already within bounds
  if (screenshot.size.width <= maxWidth) {
    return screenshot;
  }

  const ratio = maxWidth / screenshot.size.width;
  const newWidth = maxWidth;
  const newHeight = Math.round(screenshot.size.height * ratio);

  const timestamp = Date.now();
  const tmpInput = join(tmpdir(), `computer-scale-in-${timestamp}.png`);
  const tmpOutput = join(tmpdir(), `computer-scale-out-${timestamp}.png`);

  try {
    // Write original to temp file
    const buffer = Buffer.from(screenshot.base64, "base64");
    await writeFile(tmpInput, buffer);

    // Use sips to resize (built into macOS)
    const proc = Bun.spawn(
      [
        "sips",
        "--resampleWidth", String(newWidth),
        tmpInput,
        "--out", tmpOutput,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.warn(`sips resize failed (${stderr}), using original screenshot`);
      return screenshot;
    }

    // Read resized image
    const resized = await readFile(tmpOutput);
    const base64 = resized.toString("base64");

    return {
      base64,
      size: { width: newWidth, height: newHeight },
      timestamp: screenshot.timestamp,
    };
  } finally {
    // Clean up temp files
    await unlink(tmpInput).catch(() => {});
    await unlink(tmpOutput).catch(() => {});
  }
}

/**
 * Calculate the scaled dimensions for a display size.
 * Used to tell the AI model what resolution the screenshot is at.
 */
export function getScaledSize(
  original: ScreenSize,
  maxWidth: number = DEFAULT_MAX_WIDTH
): ScreenSize {
  if (original.width <= maxWidth) return original;
  const ratio = maxWidth / original.width;
  return {
    width: maxWidth,
    height: Math.round(original.height * ratio),
  };
}
