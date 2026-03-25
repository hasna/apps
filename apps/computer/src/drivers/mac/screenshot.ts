import { tmpdir } from "os";
import { join } from "path";
import { readFile, unlink } from "fs/promises";
import type { Screenshot, ScreenSize } from "../../types/index.js";

/**
 * Capture a screenshot using macOS screencapture.
 * Returns base64 PNG data and screen dimensions.
 */
export async function captureScreenshot(): Promise<Screenshot> {
  const timestamp = Date.now();
  const tmpPath = join(tmpdir(), `computer-screenshot-${timestamp}.png`);

  const proc = Bun.spawn(["screencapture", "-x", "-C", "-t", "png", tmpPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`screencapture failed: ${stderr}`);
  }

  const data = await readFile(tmpPath);
  const base64 = data.toString("base64");

  // Clean up temp file
  await unlink(tmpPath).catch(() => {});

  // Get screen size from the image dimensions
  const size = await getScreenSize();

  return { base64, size, timestamp };
}

/**
 * Get the main display screen size using system_profiler.
 */
export async function getScreenSize(): Promise<ScreenSize> {
  const proc = Bun.spawn(
    ["osascript", "-e", 'tell application "Finder" to get bounds of window of desktop'],
    { stdout: "pipe", stderr: "pipe" }
  );
  await proc.exited;

  const stdout = await new Response(proc.stdout).text();
  // Returns: "0, 0, 1920, 1080" (or similar)
  const parts = stdout.trim().split(",").map((s) => parseInt(s.trim(), 10));

  if (parts.length >= 4 && !isNaN(parts[2]) && !isNaN(parts[3])) {
    return { width: parts[2], height: parts[3] };
  }

  // Fallback: use screenresolution or defaults
  const fallback = Bun.spawn(
    ["osascript", "-e", "tell application \"Finder\" to get {do shell script \"system_profiler SPDisplaysDataType | grep Resolution\"}"],
    { stdout: "pipe", stderr: "pipe" }
  );
  await fallback.exited;
  const fallbackOut = await new Response(fallback.stdout).text();

  const match = fallbackOut.match(/(\d+)\s*x\s*(\d+)/);
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
