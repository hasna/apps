import { tmpdir } from "os";
import { join } from "path";
import { readFile, unlink } from "fs/promises";
import type { DriverExecutionContext, Screenshot, ScreenSize } from "../../types/index.js";
import { formatMacProcessFailure, runMacProcess } from "./process.js";

/**
 * Capture a screenshot using macOS screencapture.
 * Returns base64 PNG data and screen dimensions.
 */
export async function captureScreenshot(
  displayNumber?: number,
  context: DriverExecutionContext = {},
): Promise<Screenshot> {
  const timestamp = Date.now();
  const tmpPath = join(tmpdir(), `computer-screenshot-${timestamp}.png`);

  const args = ["screencapture", "-x", "-C", "-t", "png"];
  if (displayNumber) {
    args.push(`-D${displayNumber}`);
  }
  args.push(tmpPath);

  const result = await runMacProcess(args, { signal: context.signal });
  if (result.exitCode !== 0) {
    await unlink(tmpPath).catch(() => {});
    throw new Error(formatMacProcessFailure(args, result));
  }

  try {
    const data = await readFile(tmpPath);
    const base64 = data.toString("base64");
    const size = await getScreenSize(context);

    return {
      base64,
      size,
      timestamp,
      coordinateSpace: {
        kind: "screenshot",
        size,
        origin: { x: 0, y: 0 },
        displayNumber,
      },
    };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Get the main display screen size using system_profiler.
 */
export async function getScreenSize(context: DriverExecutionContext = {}): Promise<ScreenSize> {
  const primary = await runMacProcess([
    "osascript",
    "-e",
    'tell application "Finder" to get bounds of window of desktop',
  ], { signal: context.signal });

  // Returns: "0, 0, 1920, 1080" (or similar)
  const parts = primary.stdout.trim().split(",").map((s) => parseInt(s.trim(), 10));

  if (primary.exitCode === 0 && parts.length >= 4 && !isNaN(parts[2]) && !isNaN(parts[3])) {
    return { width: parts[2], height: parts[3] };
  }

  // Fallback: use screenresolution or defaults
  const fallback = await runMacProcess([
    "osascript",
    "-e",
    "tell application \"Finder\" to get {do shell script \"system_profiler SPDisplaysDataType | grep Resolution\"}",
  ], { signal: context.signal });

  const match = fallback.stdout.match(/(\d+)\s*x\s*(\d+)/);
  if (match) {
    return { width: parseInt(match[1]), height: parseInt(match[2]) };
  }

  // Last resort defaults
  return { width: 1920, height: 1080 };
}

/**
 * Save a screenshot to a file on disk.
 */
export async function saveScreenshotToFile(
  screenshot: Screenshot,
  dir: string,
  filename: string
): Promise<string> {
  const path = join(dir, filename);
  const buffer = Buffer.from(screenshot.base64, "base64");
  await Bun.write(path, buffer);
  return path;
}
