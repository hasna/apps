import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { getDataDir } from "../db/schema.js";
import {
  createVideoRecording,
  updateVideoRecording,
} from "../db/video-recordings.js";
import { importFileToDownloads } from "./downloads.js";
import { resolveVideoRecordingPreset } from "./video-presets.js";
import type { VideoRecording, VideoRecordingFormat, VideoRecordingOptions, VideoRecordingQuality } from "../types/index.js";
import { BrowserError } from "../types/index.js";
import { ensureOwnerOnlyDir, ensureOwnerOnlyFile } from "./security.js";

const require = createRequire(import.meta.url);

const QUALITY_SIZES: Record<Exclude<VideoRecordingQuality, "source">, { width: number; height: number }> = {
  low: { width: 854, height: 480 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
  ultra: { width: 3840, height: 2160 },
};

export interface X11RecordOptions extends VideoRecordingOptions {
  durationMs?: number;
  prepare?: (page: Page) => Promise<void>;
  drive?: (page: Page) => Promise<void>;
}

export interface X11FfmpegArgsOptions {
  display: string;
  width: number;
  height: number;
  fps: number;
  format: VideoRecordingFormat;
  crf?: number;
  videoBitrate?: string;
  ffmpegPreset?: string;
  outputPath: string;
}

function resolveFfmpegPath(): string | null {
  try {
    const bundled = require("ffmpeg-static");
    if (typeof bundled === "string" && bundled && existsSync(bundled)) return bundled;
  } catch {}

  const explicit = process.env["BROWSER_FFMPEG_PATH"];
  if (explicit && existsSync(explicit)) return explicit;
  try {
    return execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

export function resolveXvfbPath(explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env["BROWSER_XVFB_PATH"],
    "/usr/bin/Xvfb",
    "/usr/local/bin/Xvfb",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  try {
    const found = execFileSync("which", ["Xvfb"], { encoding: "utf8" }).trim();
    return found || null;
  } catch {
    return null;
  }
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  const raw = Number.isFinite(value) ? value as number : fallback;
  const rounded = Math.max(320, Math.min(7680, Math.round(raw)));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function normalizeFps(value: number | undefined): number {
  if (!Number.isFinite(value)) return 60;
  return Math.max(1, Math.min(120, Math.round(value as number)));
}

function normalizeScale(value: number | undefined, width: number): number {
  if (!Number.isFinite(value)) return width >= 3000 ? 2 : 1;
  return Math.max(0.5, Math.min(4, value as number));
}

function getVideoTempDir(projectId?: string): string {
  const base = join(getDataDir(), "videos");
  const date = new Date().toISOString().split("T")[0];
  const dir = projectId ? join(base, projectId, date) : join(base, date);
  ensureOwnerOnlyDir(dir);
  return dir;
}

function safeName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "recording";
}

function resolveSize(opts: VideoRecordingOptions): { width: number; height: number } {
  const preset = resolveVideoRecordingPreset(opts);
  if (preset.width && preset.height) {
    return {
      width: normalizeDimension(opts.width ?? preset.width, preset.width),
      height: normalizeDimension(opts.height ?? preset.height, preset.height),
    };
  }
  if (opts.width && opts.height) {
    return {
      width: normalizeDimension(opts.width, opts.width),
      height: normalizeDimension(opts.height, opts.height),
    };
  }
  if (preset.quality !== "source") return QUALITY_SIZES[preset.quality];
  return { width: 1920, height: 1080 };
}

function normalizeBitrate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^\d+(?:\.\d+)?[kKmMgG]?$/.test(trimmed) ? trimmed : undefined;
}

export function buildX11FfmpegArgs(opts: X11FfmpegArgsOptions): string[] {
  const args = [
    "-y",
    "-f", "x11grab",
    "-thread_queue_size", "1024",
    "-video_size", `${opts.width}x${opts.height}`,
    "-framerate", String(opts.fps),
    "-draw_mouse", "0",
    "-i", `${opts.display}.0`,
    "-an",
  ];

  if (opts.format === "mov") {
    args.push(
      "-c:v", "prores_ks",
      "-profile:v", "3",
      "-pix_fmt", "yuv422p10le",
      "-vendor", "apl0",
      "-r", String(opts.fps),
      "-movflags", "+faststart",
      opts.outputPath,
    );
    return args;
  }

  const crf = Number.isFinite(opts.crf) ? Math.max(0, Math.min(51, Math.round(opts.crf as number))) : 12;
  const preset = opts.ffmpegPreset?.trim() || "ultrafast";
  args.push(
    "-c:v", "libx264",
    "-preset", preset,
    "-tune", "zerolatency",
    "-crf", String(crf),
  );
  const bitrate = normalizeBitrate(opts.videoBitrate);
  if (bitrate) args.push("-b:v", bitrate);
  args.push(
    "-r", String(opts.fps),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    opts.outputPath,
  );
  return args;
}

function findFreeDisplay(): number {
  const start = 90 + Math.floor(Math.random() * 50);
  for (let offset = 0; offset < 100; offset += 1) {
    const display = start + offset;
    if (!existsSync(`/tmp/.X${display}-lock`) && !existsSync(`/tmp/.X11-unix/X${display}`)) return display;
  }
  throw new BrowserError("No free X display number found for realtime recording.", "VIDEO_X11_DISPLAY_UNAVAILABLE");
}

async function waitForXvfb(display: number, proc: ChildProcess, stderr: string[]): Promise<void> {
  const socket = `/tmp/.X11-unix/X${display}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5_000) {
    if (proc.exitCode !== null) {
      throw new BrowserError(`Xvfb exited early: ${stderr.join("").slice(-1000)}`, "VIDEO_XVFB_START_FAILED");
    }
    if (existsSync(socket)) return;
    await delay(50);
  }
  throw new BrowserError(`Timed out waiting for Xvfb display :${display}`, "VIDEO_XVFB_START_TIMEOUT");
}

async function stopProcess(proc: ChildProcess, graceful: () => void, timeoutMs = 5_000): Promise<void> {
  if (proc.exitCode !== null) return;
  graceful();
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => proc.once("exit", () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ]);
  if (!exited && proc.exitCode === null) {
    proc.kill("SIGKILL");
    await new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  }
}

export async function recordX11BrowserVideo(target: string, opts: X11RecordOptions = {}): Promise<VideoRecording> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) {
    throw new BrowserError("Realtime X11 recording requires ffmpeg.", "VIDEO_TRANSCODER_MISSING");
  }
  const xvfbPath = resolveXvfbPath(opts.xvfbPath);
  if (!xvfbPath) {
    throw new BrowserError(
      "Realtime X11 recording requires Xvfb. Install xvfb or set BROWSER_XVFB_PATH/--xvfb-path.",
      "VIDEO_XVFB_MISSING",
    );
  }

  const { width, height } = resolveSize(opts);
  const fps = normalizeFps(opts.fps);
  const scale = normalizeScale(opts.displayScale, width);
  const cssWidth = Math.max(320, Math.round(width / scale));
  const cssHeight = Math.max(240, Math.round(height / scale));
  const format = opts.format ?? "mp4";
  if (format === "webm") {
    throw new BrowserError("Realtime X11 recording currently supports mp4 or mov output.", "VIDEO_CAPTURE_MODE_INVALID");
  }

  const displayNumber = findFreeDisplay();
  const display = `:${displayNumber}`;
  const name = opts.name ?? `video-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const recording = createVideoRecording({
    project_id: opts.projectId,
    name,
    status: "recording",
    url: target,
    format,
    width,
    height,
  });

  const recordingName = safeName(name);
  const outputPath = join(getVideoTempDir(opts.projectId), `${recordingName}-${recording.id}.${format}`);
  const xvfbStderr: string[] = [];
  const ffmpegStderr: string[] = [];
  let xvfb: ChildProcess | undefined;
  let ffmpegProc: ChildProcess | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  const startedAt = Date.now();

  try {
    xvfb = spawn(xvfbPath, [
      display,
      "-screen", "0", `${width}x${height}x24`,
      "-ac",
      "-nolisten", "tcp",
      "+extension", "RANDR",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    xvfb.stderr?.on("data", (chunk) => xvfbStderr.push(String(chunk)));
    await waitForXvfb(displayNumber, xvfb, xvfbStderr);

    browser = await chromium.launch({
      headless: false,
      env: { ...process.env, DISPLAY: display },
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-features=CalculateNativeWinOcclusion",
        "--high-dpi-support=1",
        `--force-device-scale-factor=${scale}`,
        `--window-size=${width},${height}`,
        "--start-fullscreen",
      ],
    });
    context = await browser.newContext({
      viewport: { width: cssWidth, height: cssHeight },
      deviceScaleFactor: scale,
      colorScheme: "light",
    });
    page = await context.newPage();
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    if (opts.prepare) {
      await opts.prepare(page);
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await delay(300);
    }

    const title = await page.title().catch(() => undefined);
    if (title) updateVideoRecording(recording.id, { title });

    ffmpegProc = spawn(ffmpeg, buildX11FfmpegArgs({
      display,
      width,
      height,
      fps,
      format,
      crf: opts.crf,
      videoBitrate: opts.videoBitrate,
      ffmpegPreset: opts.ffmpegPreset,
      outputPath,
    }), { stdio: ["pipe", "pipe", "pipe"] });
    ffmpegProc.stderr?.on("data", (chunk) => ffmpegStderr.push(String(chunk)));
    await delay(500);
    if (ffmpegProc.exitCode !== null) {
      throw new Error(`ffmpeg exited early: ${ffmpegStderr.join("").slice(-1000)}`);
    }

    if (opts.drive) {
      await opts.drive(page);
    } else {
      await delay(opts.durationMs ?? 5_000);
    }

    await stopProcess(ffmpegProc, () => {
      try { ffmpegProc?.stdin?.write("q"); } catch {}
    }, 10_000);

    if (!existsSync(outputPath)) {
      throw new Error(`ffmpeg did not produce output: ${ffmpegStderr.join("").slice(-1000)}`);
    }
    ensureOwnerOnlyFile(outputPath);

    const finalUrl = page.url() || target;
    const finalTitle = await page.title().catch(() => title);
    const outputSize = statSync(outputPath).size;
    const download = importFileToDownloads(outputPath, `${recordingName}.${format}`, {
      type: "video",
      sourceUrl: finalUrl,
      metadata: {
        video_recording_id: recording.id,
        width,
        height,
        format,
        fps,
        capture_mode: "x11",
        display,
        display_scale: scale,
        css_width: cssWidth,
        css_height: cssHeight,
        ffmpeg_preset: opts.ffmpegPreset ?? "ultrafast",
        crf: opts.crf ?? 12,
        video_bitrate: opts.videoBitrate,
      },
    });
    try { unlinkSync(outputPath); } catch {}

    return updateVideoRecording(recording.id, {
      status: "completed",
      path: download.path,
      download_id: download.id,
      url: finalUrl,
      title: finalTitle,
      size_bytes: download.size_bytes || outputSize,
      duration_ms: Date.now() - startedAt,
      stopped_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateVideoRecording(recording.id, {
      status: "failed",
      duration_ms: Date.now() - startedAt,
      stopped_at: new Date().toISOString(),
      error: message,
    });
    throw new BrowserError(`Realtime X11 video recording failed: ${message}`, "VIDEO_X11_RECORDING_FAILED");
  } finally {
    if (ffmpegProc) {
      await stopProcess(ffmpegProc, () => {
        try { ffmpegProc?.stdin?.write("q"); } catch {}
      }, 2_000).catch(() => {});
    }
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (xvfb) {
      await stopProcess(xvfb, () => xvfb?.kill("SIGTERM"), 2_000).catch(() => {});
    }
  }
}
