import type { Browser, BrowserContext, CDPSession, Page, Video } from "playwright";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { existsSync, rmSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { getDataDir } from "../db/schema.js";
import {
  createVideoRecording,
  deleteVideoRecording as deleteVideoRecordingRow,
  getVideoRecording,
  listVideoRecordings,
  updateVideoRecording,
  type VideoRecordingFilter,
} from "../db/video-recordings.js";
import { importFileToDownloads, deleteDownload } from "./downloads.js";
import {
  getSessionBrowser,
  getSessionEngine,
  getSessionPage,
  setSessionPage,
} from "./session.js";
import type {
  BrowserEngine,
  VideoRecording,
  VideoRecordingCaptureMode,
  VideoRecordingCodec,
  VideoRecordingEncoding,
  VideoRecordingFormat,
  VideoRecordingOptions,
  VideoRecordingQuality,
} from "../types/index.js";
import { BrowserError } from "../types/index.js";
import { resolveVideoRecordingPreset, type ResolvedVideoPreset } from "./video-presets.js";
import { ensureOwnerOnlyDir, ensureOwnerOnlyFile, writeOwnerOnlyFile } from "./security.js";

interface ActiveVideoRecording {
  id: string;
  sessionId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  video: Video | null;
  engine: BrowserEngine;
  width: number;
  height: number;
  startedAt: number;
  preset: ResolvedVideoPreset;
  format: VideoRecordingFormat;
  options: VideoRecordingOptions;
  captureMode: VideoRecordingCaptureMode;
  cdpSession?: CDPSession;
  frameDir?: string;
  frames?: Array<{ file: string; timeMs: number }>;
  frameCount?: number;
}

const activeVideoRecordings = new Map<string, ActiveVideoRecording>();
const require = createRequire(import.meta.url);

const QUALITY_SIZES: Record<Exclude<VideoRecordingQuality, "source">, { width: number; height: number }> = {
  low: { width: 854, height: 480 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
  ultra: { width: 3840, height: 2160 },
};

const X264_PRESETS = new Set([
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
  "placebo",
]);

export interface VideoTranscodeSettings {
  format: Exclude<VideoRecordingFormat, "webm">;
  codec: VideoRecordingCodec;
  encoding: VideoRecordingEncoding;
  crf?: number;
  videoBitrate?: string;
  ffmpegPreset?: string;
  fps?: number;
}

export interface VideoOutputValidationInput {
  path: string;
  width: number;
  height: number;
  expectedWidth?: number;
  expectedHeight?: number;
  minSizeBytes?: number;
}

export interface VideoOutputValidationResult {
  ok: true;
  sizeBytes: number;
  width: number;
  height: number;
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

function normalizeCrf(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(51, Math.round(value as number)));
}

function normalizeVideoBitrate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^\d+(?:\.\d+)?[kKmMgG]?$/.test(trimmed) ? trimmed : undefined;
}

function normalizeX264Preset(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const preset = value.trim().toLowerCase();
  return X264_PRESETS.has(preset) ? preset : undefined;
}

function normalizeFps(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(120, Math.round(value as number)));
}

function defaultEncodingFor(format: VideoRecordingFormat, quality: VideoRecordingQuality): VideoRecordingEncoding {
  if (format === "mov") return "prores";
  if (quality === "low" || quality === "medium") return "balanced";
  return "crisp";
}

function resolveCaptureMode(
  format: VideoRecordingFormat,
  quality: VideoRecordingQuality,
  opts: VideoRecordingOptions,
): VideoRecordingCaptureMode {
  if (opts.captureMode) return opts.captureMode;
  if (format === "webm") return "native";
  const encoding = opts.encoding ?? defaultEncodingFor(format, quality);
  if (format === "mov" || quality === "ultra" || encoding === "crisp" || encoding === "lossless" || encoding === "prores") {
    return "cdp";
  }
  return "native";
}

export function resolveVideoTranscodeSettings(
  format: VideoRecordingFormat,
  quality: VideoRecordingQuality,
  opts: VideoRecordingOptions = {},
): VideoTranscodeSettings | null {
  if (format === "webm") return null;

  const encoding = opts.encoding ?? defaultEncodingFor(format, quality);
  const codec = opts.codec ?? (format === "mov" || encoding === "prores" ? "prores" : "h264");
  if (encoding === "prores" && codec !== "prores") {
    throw new BrowserError("encoding='prores' requires codec='prores'.", "VIDEO_TRANSCODE_OPTIONS_INVALID");
  }
  if (codec === "prores" && format !== "mov") {
    throw new BrowserError("ProRes output requires format='mov'.", "VIDEO_TRANSCODE_OPTIONS_INVALID");
  }
  if (codec === "h264" && format !== "mp4") {
    throw new BrowserError("H.264 output requires format='mp4'.", "VIDEO_TRANSCODE_OPTIONS_INVALID");
  }

  const defaults = (() => {
    if (codec === "prores") {
      return { encoding: "prores" as const };
    }
    if (encoding === "lossless") {
      return { crf: undefined, ffmpegPreset: "veryslow" };
    }
    if (encoding === "balanced") {
      return { crf: 18, ffmpegPreset: "medium" };
    }
    return { crf: quality === "ultra" ? 10 : 12, ffmpegPreset: "slow" };
  })();

  return {
    format,
    codec,
    encoding,
    crf: normalizeCrf(opts.crf ?? defaults.crf),
    videoBitrate: normalizeVideoBitrate(opts.videoBitrate),
    ffmpegPreset: normalizeX264Preset(opts.ffmpegPreset) ?? defaults.ffmpegPreset,
    fps: normalizeFps(opts.fps) ?? 30,
  };
}

function appendCodecArgs(args: string[], settings: VideoTranscodeSettings): void {
  if (settings.codec === "prores") {
    args.push(
      "-c:v", "prores_ks",
      "-profile:v", "3",
      "-pix_fmt", "yuv422p10le",
      "-vendor", "apl0",
      "-movflags", "+faststart",
    );
    return;
  }

  args.push("-c:v", "libx264");
  if (settings.ffmpegPreset) args.push("-preset", settings.ffmpegPreset);

  if (settings.encoding === "lossless") {
    args.push(
      "-qp", "0",
      "-profile:v", "high444",
      "-pix_fmt", "yuv444p",
    );
  } else {
    if (settings.crf !== undefined) args.push("-crf", String(settings.crf));
    if (settings.videoBitrate) args.push("-b:v", settings.videoBitrate);
    args.push(
      "-tune", "animation",
      "-profile:v", "high",
      "-pix_fmt", "yuv420p",
    );
  }

  args.push("-movflags", "+faststart");
}

export function validateVideoOutput(input: VideoOutputValidationInput): VideoOutputValidationResult {
  if (!existsSync(input.path)) {
    throw new BrowserError(`Video output was not created: ${input.path}`, "VIDEO_OUTPUT_INVALID");
  }
  const sizeBytes = statSync(input.path).size;
  const minSizeBytes = input.minSizeBytes ?? 1;
  if (sizeBytes < minSizeBytes) {
    throw new BrowserError(`Video output is too small (${sizeBytes} bytes): ${input.path}`, "VIDEO_OUTPUT_INVALID");
  }
  if (input.width <= 0 || input.height <= 0) {
    throw new BrowserError(`Video output dimensions are invalid: ${input.width}x${input.height}`, "VIDEO_OUTPUT_INVALID");
  }
  if (input.expectedWidth && input.width < input.expectedWidth) {
    throw new BrowserError(`Video output width ${input.width}px is below expected ${input.expectedWidth}px`, "VIDEO_OUTPUT_INVALID");
  }
  if (input.expectedHeight && input.height < input.expectedHeight) {
    throw new BrowserError(`Video output height ${input.height}px is below expected ${input.expectedHeight}px`, "VIDEO_OUTPUT_INVALID");
  }
  return { ok: true, sizeBytes, width: input.width, height: input.height };
}

export function buildVideoTranscodeArgs(
  inputPath: string,
  outputPath: string,
  settings: VideoTranscodeSettings,
): string[] {
  const args = [
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-an",
  ];

  appendCodecArgs(args, settings);
  args.push(outputPath);
  return args;
}

export function buildFrameTranscodeArgs(
  concatPath: string,
  outputPath: string,
  settings: VideoTranscodeSettings,
): string[] {
  const args = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
  ];
  if (settings.fps) args.push("-r", String(settings.fps));
  appendCodecArgs(args, settings);
  args.push(outputPath);
  return args;
}

function transcodeWebm(inputPath: string, outputPath: string, settings: VideoTranscodeSettings): void {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) {
    throw new BrowserError(
      "Video export requires ffmpeg. Install ffmpeg or set BROWSER_FFMPEG_PATH, or record with format='webm'.",
      "VIDEO_TRANSCODER_MISSING",
    );
  }

  try {
    execFileSync(ffmpeg, buildVideoTranscodeArgs(inputPath, outputPath, settings), { stdio: "pipe" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(`Video export failed: ${message}`, "VIDEO_TRANSCODE_FAILED");
  }
}

function frameFileName(index: number): string {
  return `frame-${String(index).padStart(6, "0")}.png`;
}

function appendFrame(active: ActiveVideoRecording, data: Buffer, timeMs = Date.now()): void {
  if (!active.frameDir || !active.frames) return;
  const index = active.frameCount ?? 0;
  const file = frameFileName(index);
  writeOwnerOnlyFile(join(active.frameDir, file), data);
  active.frames.push({ file, timeMs });
  active.frameCount = index + 1;
}

async function captureCurrentFrame(active: ActiveVideoRecording): Promise<void> {
  const data = await active.page.screenshot({ type: "png" });
  appendFrame(active, data, Date.now());
}

async function startCdpFrameCapture(active: ActiveVideoRecording): Promise<void> {
  active.frameDir = join(getVideoTempDir(active.options.projectId), `${safeName(active.id)}-frames`);
  active.frames = [];
  active.frameCount = 0;
  ensureOwnerOnlyDir(active.frameDir);

  await captureCurrentFrame(active);
  const client = await active.page.context().newCDPSession(active.page);
  active.cdpSession = client;
  client.on("Page.screencastFrame", (event: { data: string; sessionId: number }) => {
    client.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
    appendFrame(active, Buffer.from(event.data, "base64"), Date.now());
  });
  await client.send("Page.startScreencast", {
    format: "png",
    maxWidth: active.width,
    maxHeight: active.height,
    everyNthFrame: 1,
  });
}

function writeFrameConcatFile(active: ActiveVideoRecording, stoppedAt: number): string {
  if (!active.frameDir || !active.frames?.length) {
    throw new Error("CDP frame capture produced no frames");
  }
  const lines: string[] = [];
  for (let i = 0; i < active.frames.length; i += 1) {
    const frame = active.frames[i];
    const next = active.frames[i + 1];
    const durationMs = Math.max(1, (next?.timeMs ?? stoppedAt) - frame.timeMs);
    lines.push(`file '${frame.file}'`);
    lines.push(`duration ${(durationMs / 1000).toFixed(6)}`);
  }
  lines.push(`file '${active.frames[active.frames.length - 1].file}'`);
  const concatPath = join(active.frameDir, "frames.txt");
  writeOwnerOnlyFile(concatPath, `${lines.join("\n")}\n`);
  return concatPath;
}

function transcodeFrames(concatPath: string, outputPath: string, settings: VideoTranscodeSettings): void {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) {
    throw new BrowserError(
      "Video export requires ffmpeg. Install ffmpeg or set BROWSER_FFMPEG_PATH.",
      "VIDEO_TRANSCODER_MISSING",
    );
  }

  try {
    execFileSync(ffmpeg, buildFrameTranscodeArgs(concatPath, outputPath, settings), {
      stdio: "pipe",
      cwd: dirname(concatPath),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(`Frame video export failed: ${message}`, "VIDEO_TRANSCODE_FAILED");
  }
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 1280;
  const rounded = Math.max(320, Math.min(4096, Math.round(value)));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function resolveVideoSize(page: Page, preset: ResolvedVideoPreset, opts?: VideoRecordingOptions): { width: number; height: number } {
  if (preset.width && preset.height) {
    return {
      width: normalizeDimension(preset.width),
      height: normalizeDimension(preset.height),
    };
  }

  if (opts?.width && opts?.height) {
    return {
      width: normalizeDimension(opts.width),
      height: normalizeDimension(opts.height),
    };
  }

  const quality = preset.quality;
  if (quality !== "source") return QUALITY_SIZES[quality];

  const viewport = page.viewportSize();
  return {
    width: normalizeDimension(opts?.width ?? viewport?.width ?? 1280),
    height: normalizeDimension(opts?.height ?? viewport?.height ?? 720),
  };
}

async function applyTuiVideoStyle(
  page: Page,
  preset: ResolvedVideoPreset,
  canvas: { width: number; height: number }
): Promise<void> {
  const theme = preset.tuiTheme === "dark"
    ? {
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
      }
    : {
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
      };

  await page.evaluate(({ preset, canvas, theme }) => {
    const frame = preset.tuiFrame ?? {};
    const zoom = Math.max(0.5, Math.min(2, preset.tuiZoom ?? 1));
    const scaled = (value: number) => `${Math.max(1, Math.round(value * zoom))}px`;
    const win = window as any;
    const term = win.term ?? win.terminal;
    if (term?.options) {
      term.options.theme = theme;
      if (preset.tuiFontSize) term.options.fontSize = Math.max(8, Math.round(preset.tuiFontSize * zoom));
      term.options.lineHeight = 1.18;
      term.options.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
    }

    const body = document.body;
    const terminal = (document.getElementById("terminal-container") as HTMLElement | null)
      ?? (document.querySelector(".xterm")?.parentElement as HTMLElement | null);
    const background = frame.background || (theme.background === "#ffffff" ? "#f4f5f7" : "#111827");

    document.documentElement.style.margin = "0";
    document.documentElement.style.width = "100%";
    document.documentElement.style.height = "100%";
    body.style.margin = "0";
    body.style.width = "100vw";
    body.style.height = "100vh";
    body.style.overflow = "hidden";
    body.style.background = background;

    if (!terminal) return;

    if (!frame.enabled) {
      terminal.style.width = "100vw";
      terminal.style.height = "100vh";
      terminal.style.borderRadius = "0";
      terminal.style.boxShadow = "none";
      terminal.style.overflow = "hidden";
      terminal.style.background = theme.background;
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
      return;
    }

    let stage = document.getElementById("__browser_video_stage") as HTMLDivElement | null;
    if (!stage) {
      stage = document.createElement("div");
      stage.id = "__browser_video_stage";
      body.appendChild(stage);
    }

    let shell = document.getElementById("__browser_video_terminal_shell") as HTMLDivElement | null;
    if (!shell) {
      shell = document.createElement("div");
      shell.id = "__browser_video_terminal_shell";
      stage.appendChild(shell);
    }

    let titlebar = document.getElementById("__browser_video_titlebar") as HTMLDivElement | null;
    if (!titlebar) {
      titlebar = document.createElement("div");
      titlebar.id = "__browser_video_titlebar";
      const controls = document.createElement("div");
      controls.id = "__browser_video_controls";
      for (const color of ["#ff5f57", "#ffbd2e", "#28c840"]) {
        const dot = document.createElement("span");
        dot.style.width = scaled(14);
        dot.style.height = scaled(14);
        dot.style.borderRadius = "999px";
        dot.style.display = "inline-block";
        dot.style.background = color;
        dot.style.boxShadow = "inset 0 0 0 1px rgba(0,0,0,0.12)";
        controls.appendChild(dot);
      }
      const title = document.createElement("div");
      title.id = "__browser_video_title";
      title.textContent = frame.title || "Terminal";
      titlebar.appendChild(controls);
      titlebar.appendChild(title);
      shell.appendChild(titlebar);
    }

    let content = document.getElementById("__browser_video_terminal_content") as HTMLDivElement | null;
    if (!content) {
      content = document.createElement("div");
      content.id = "__browser_video_terminal_content";
      shell.appendChild(content);
    }

    if (terminal.parentElement !== content) {
      content.appendChild(terminal);
    }

    const padding = Math.max(0, frame.padding ?? 64);
    const maxWidth = Math.max(320, canvas.width - padding * 2);
    const maxHeight = Math.max(240, canvas.height - padding * 2);
    const fitCanvas = frame.fit === "canvas";
    const shellWidth = fitCanvas ? maxWidth : Math.min(frame.width ?? maxWidth, maxWidth);
    const shellHeight = fitCanvas ? maxHeight : Math.min(frame.height ?? maxHeight, maxHeight);
    const radius = frame.borderRadius ?? 18;

    stage.style.position = "fixed";
    stage.style.inset = "0";
    stage.style.width = "100vw";
    stage.style.height = "100vh";
    stage.style.display = "flex";
    stage.style.alignItems = "center";
    stage.style.justifyContent = "center";
    stage.style.padding = `${padding}px`;
    stage.style.boxSizing = "border-box";
    stage.style.background = background;

    shell.style.width = `${shellWidth}px`;
    shell.style.height = `${shellHeight}px`;
    shell.style.display = "flex";
    shell.style.flexDirection = "column";
    shell.style.overflow = "hidden";
    shell.style.borderRadius = `${radius}px`;
    shell.style.background = theme.background;
    shell.style.border = theme.background === "#ffffff"
      ? "1px solid rgba(15, 23, 42, 0.16)"
      : "1px solid rgba(255, 255, 255, 0.12)";
    shell.style.boxShadow = frame.shadow === false
      ? "none"
      : "0 24px 70px rgba(15, 23, 42, 0.22), 0 8px 22px rgba(15, 23, 42, 0.10)";

    titlebar.style.height = scaled(46);
    titlebar.style.flex = `0 0 ${scaled(46)}`;
    titlebar.style.display = "grid";
    titlebar.style.gridTemplateColumns = `${scaled(90)} 1fr ${scaled(90)}`;
    titlebar.style.alignItems = "center";
    titlebar.style.padding = `0 ${scaled(18)}`;
    titlebar.style.boxSizing = "border-box";
    titlebar.style.background = theme.background === "#ffffff" ? "#f8fafc" : "#252526";
    titlebar.style.borderBottom = theme.background === "#ffffff"
      ? "1px solid rgba(15, 23, 42, 0.10)"
      : "1px solid rgba(255, 255, 255, 0.10)";

    const controls = document.getElementById("__browser_video_controls") as HTMLElement | null;
    if (controls) {
      controls.style.display = "flex";
      controls.style.gap = scaled(9);
      controls.style.alignItems = "center";
    }

    const title = document.getElementById("__browser_video_title") as HTMLElement | null;
    if (title) {
      title.textContent = frame.title || "Terminal";
      title.style.textAlign = "center";
      title.style.fontFamily = "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      title.style.fontSize = scaled(15);
      title.style.fontWeight = "600";
      title.style.color = theme.background === "#ffffff" ? "#475569" : "#d4d4d4";
      title.style.whiteSpace = "nowrap";
      title.style.overflow = "hidden";
      title.style.textOverflow = "ellipsis";
    }

    content.style.flex = "1 1 auto";
    content.style.minHeight = "0";
    content.style.overflow = "hidden";
    content.style.background = theme.background;

    terminal.style.width = "100%";
    terminal.style.height = "100%";
    terminal.style.background = theme.background;
    terminal.style.overflow = "hidden";
    terminal.style.borderRadius = "0";
    terminal.style.boxShadow = "none";

    const xterm = terminal.querySelector(".xterm") as HTMLElement | null;
    if (xterm) {
      xterm.style.width = "100%";
      xterm.style.height = "100%";
      xterm.style.padding = `${scaled(18)} ${scaled(20)}`;
      xterm.style.boxSizing = "border-box";
      xterm.style.background = theme.background;
    }

    const viewport = terminal.querySelector(".xterm-viewport") as HTMLElement | null;
    if (viewport) viewport.style.background = theme.background;

    try { win.fitAddon?.fit?.(); } catch {}
    try { win.fit?.(); } catch {}
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => {
      try { win.fitAddon?.fit?.(); } catch {}
      try { win.fit?.(); } catch {}
      window.dispatchEvent(new Event("resize"));
    }, 100);
  }, { preset, canvas, theme });

  await page.waitForTimeout(250).catch(() => {});
}

async function safePageUrl(page: Page): Promise<string | undefined> {
  try {
    return page.url();
  } catch {
    return undefined;
  }
}

async function safePageTitle(page: Page): Promise<string | undefined> {
  try {
    return await page.title();
  } catch {
    return undefined;
  }
}

async function createReplacementPage(
  active: ActiveVideoRecording,
  url?: string,
  storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>
): Promise<void> {
  const context = await active.browser.newContext({
    viewport: { width: active.width, height: active.height },
    storageState,
  });
  const page = await context.newPage();
  if (url && url !== "about:blank") {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  }
  if (active.engine === "tui") {
    await page.waitForSelector(".xterm-screen", { timeout: 10_000 }).catch(() => {});
    await applyTuiVideoStyle(page, active.preset, { width: active.width, height: active.height }).catch(() => {});
    await page.click(".xterm-screen").catch(() => {});
  }
  setSessionPage(active.sessionId, page);
}

export function getActiveVideoRecording(sessionId: string): VideoRecording | null {
  const active = Array.from(activeVideoRecordings.values()).find((recording) => recording.sessionId === sessionId);
  return active ? getVideoRecording(active.id) : null;
}

export async function startVideoRecording(
  sessionId: string,
  opts: VideoRecordingOptions = {}
): Promise<VideoRecording> {
  const existing = getActiveVideoRecording(sessionId);
  if (existing) {
    throw new BrowserError(`Session already has an active video recording: ${existing.id}`, "VIDEO_RECORDING_ACTIVE");
  }

  const engine = getSessionEngine(sessionId);
  if (engine === "bun" || engine === "lightpanda") {
    throw new BrowserError(`Video recording is not supported for ${engine} sessions`, "VIDEO_ENGINE_UNSUPPORTED");
  }

  const oldPage = getSessionPage(sessionId);
  const browser = getSessionBrowser(sessionId);
  const preset = resolveVideoRecordingPreset(opts);
  const { width, height } = resolveVideoSize(oldPage, preset, opts);
  const format = opts.format ?? "webm";
  const captureMode = resolveCaptureMode(format, preset.quality, opts);
  if (captureMode === "x11") {
    throw new BrowserError(
      "Realtime X11 recording creates its own headed browser. Use recordX11BrowserVideo() or `browser video record --capture-mode x11`.",
      "VIDEO_CAPTURE_MODE_INVALID",
    );
  }
  if (captureMode === "cdp" && format === "webm") {
    throw new BrowserError("CDP frame capture requires a transcoded format: mp4 or mov.", "VIDEO_CAPTURE_MODE_INVALID");
  }
  const currentUrl = await safePageUrl(oldPage);
  const currentTitle = await safePageTitle(oldPage);
  const startedAt = Date.now();
  const name = opts.name ?? `video-${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}`;
  const tempDir = getVideoTempDir(opts.projectId);
  const storageState = await oldPage.context().storageState().catch(() => undefined);

  const recording = createVideoRecording({
    session_id: sessionId,
    project_id: opts.projectId,
    name,
    status: "recording",
    url: currentUrl,
    title: currentTitle,
    format,
    width,
    height,
  });

  try {
    const context = await browser.newContext({
      viewport: { width, height },
      ...(captureMode === "native" ? { recordVideo: { dir: tempDir, size: { width, height } } } : {}),
      storageState,
    });
    const page = await context.newPage();
    const video = captureMode === "native" ? page.video() : null;

    if (currentUrl && currentUrl !== "about:blank") {
      await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    }
    if (engine === "tui") {
      await page.waitForSelector(".xterm-screen", { timeout: 10_000 });
      await applyTuiVideoStyle(page, preset, { width, height });
      await page.click(".xterm-screen").catch(() => {});
    }

    setSessionPage(sessionId, page);
    await oldPage.context().close().catch(() => {});

    const active: ActiveVideoRecording = {
      id: recording.id,
      sessionId,
      browser,
      context,
      page,
      video,
      engine,
      width,
      height,
      startedAt,
      preset,
      format,
      options: opts,
      captureMode,
    };

    if (captureMode === "cdp") {
      await startCdpFrameCapture(active);
    }

    activeVideoRecordings.set(recording.id, active);

    return recording;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateVideoRecording(recording.id, {
      status: "failed",
      error: message,
      stopped_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    });
    throw new BrowserError(`Video recording failed to start: ${message}`, "VIDEO_START_FAILED");
  }
}

export async function stopVideoRecording(
  recordingId: string,
  opts: { keepSessionAlive?: boolean } = {}
): Promise<VideoRecording> {
  const active = activeVideoRecordings.get(recordingId);
  if (!active) {
    const recording = getVideoRecording(recordingId);
    if (recording.status === "recording") {
      throw new BrowserError(`Video recording is not active in this process: ${recordingId}`, "VIDEO_RECORDING_NOT_ACTIVE");
    }
    return recording;
  }

  const keepSessionAlive = opts.keepSessionAlive ?? true;
  const stoppedAt = Date.now();
  let finalUrl: string | undefined;
  let finalTitle: string | undefined;
  let storageState: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;

  try {
    finalUrl = await safePageUrl(active.page);
    finalTitle = await safePageTitle(active.page);
    storageState = await active.context.storageState().catch(() => undefined);

    const outputFormat = active.format;
    const recordingName = safeName(getVideoRecording(recordingId).name);
    let rawPath: string | undefined;
    let rawSize = 0;
    let finalVideoPath: string;
    let transcodeSettings: VideoTranscodeSettings | null = null;

    if (active.captureMode === "native") {
      await active.context.close();

      const videoPath = await active.video?.path();
      if (!videoPath || !existsSync(videoPath)) {
        throw new Error("Playwright did not produce a video file");
      }

      rawPath = videoPath;
      rawSize = statSync(videoPath).size;
      finalVideoPath = outputFormat === "webm"
        ? videoPath
        : join(getVideoTempDir(), `${recordingName}-${recordingId}.${outputFormat}`);

      if (outputFormat !== "webm") {
        transcodeSettings = resolveVideoTranscodeSettings(outputFormat, active.preset.quality, active.options);
        if (!transcodeSettings) throw new Error(`No transcode settings resolved for ${outputFormat}`);
        transcodeWebm(videoPath, finalVideoPath, transcodeSettings);
      }
      ensureOwnerOnlyFile(finalVideoPath);
    } else {
      if (outputFormat === "webm") {
        throw new Error("CDP frame capture requires mp4 or mov output");
      }
      await active.cdpSession?.send("Page.stopScreencast").catch(() => {});
      await captureCurrentFrame(active).catch(() => {});
      await active.context.close();

      transcodeSettings = resolveVideoTranscodeSettings(outputFormat, active.preset.quality, active.options);
      if (!transcodeSettings) throw new Error(`No transcode settings resolved for ${outputFormat}`);
      const concatPath = writeFrameConcatFile(active, stoppedAt);
      finalVideoPath = join(getVideoTempDir(), `${recordingName}-${recordingId}.${outputFormat}`);
      rawPath = concatPath;
      transcodeFrames(concatPath, finalVideoPath, transcodeSettings);
      ensureOwnerOnlyFile(finalVideoPath);
    }

    const validation = validateVideoOutput({
      path: finalVideoPath,
      width: active.width,
      height: active.height,
      expectedWidth: active.preset.width,
      expectedHeight: active.preset.height,
    });
    const outputSize = validation.sizeBytes;
    const download = importFileToDownloads(
      finalVideoPath,
      `${recordingName}.${outputFormat}`,
      {
        sessionId: active.sessionId,
        type: "video",
        sourceUrl: finalUrl,
        metadata: {
          video_recording_id: recordingId,
          width: active.width,
          height: active.height,
          format: outputFormat,
          encoding: transcodeSettings?.encoding,
          codec: transcodeSettings?.codec,
          crf: transcodeSettings?.crf,
          video_bitrate: transcodeSettings?.videoBitrate,
          ffmpeg_preset: transcodeSettings?.ffmpegPreset,
          fps: transcodeSettings?.fps,
          capture_mode: active.captureMode,
          raw_path: rawPath,
          raw_frame_count: active.frames?.length,
        },
      }
    );

    if (active.captureMode === "native") {
      if (!active.options.keepRawVideo && rawPath) {
        try { unlinkSync(rawPath); } catch {}
      }
      if (finalVideoPath !== rawPath) {
        try { unlinkSync(finalVideoPath); } catch {}
      }
    } else {
      if (!active.options.keepRawVideo && active.frameDir) {
        try { rmSync(active.frameDir, { recursive: true, force: true }); } catch {}
      }
      try { unlinkSync(finalVideoPath); } catch {}
    }

    const updated = updateVideoRecording(recordingId, {
      status: "completed",
      format: outputFormat,
      path: download.path,
      download_id: download.id,
      url: finalUrl,
      title: finalTitle,
      size_bytes: download.size_bytes || outputSize || rawSize,
      duration_ms: stoppedAt - active.startedAt,
      stopped_at: new Date(stoppedAt).toISOString(),
    });

    activeVideoRecordings.delete(recordingId);

    if (keepSessionAlive) {
      await createReplacementPage(active, finalUrl, storageState);
    }

    return updated;
  } catch (error) {
    activeVideoRecordings.delete(recordingId);
    const message = error instanceof Error ? error.message : String(error);
    const failed = updateVideoRecording(recordingId, {
      status: "failed",
      url: finalUrl,
      title: finalTitle,
      duration_ms: stoppedAt - active.startedAt,
      stopped_at: new Date(stoppedAt).toISOString(),
      error: message,
    });

    if (keepSessionAlive) {
      await createReplacementPage(active, finalUrl, storageState).catch(() => {});
    }

    throw new BrowserError(`Video recording failed to stop: ${message}`, "VIDEO_STOP_FAILED");
  }
}

export async function stopAllVideoRecordingsForSession(sessionId: string): Promise<void> {
  const active = Array.from(activeVideoRecordings.values()).filter((recording) => recording.sessionId === sessionId);
  for (const recording of active) {
    await stopVideoRecording(recording.id, { keepSessionAlive: false }).catch(() => {});
  }
}

export function listVideos(filter?: VideoRecordingFilter): VideoRecording[] {
  return listVideoRecordings(filter);
}

export function getVideo(id: string): VideoRecording {
  return getVideoRecording(id);
}

export function deleteVideo(id: string): void {
  if (activeVideoRecordings.has(id)) {
    throw new BrowserError(`Stop video recording before deleting it: ${id}`, "VIDEO_RECORDING_ACTIVE");
  }
  const recording = getVideoRecording(id);
  if (recording.download_id) {
    deleteDownload(recording.download_id, recording.session_id);
  } else if (recording.path && existsSync(recording.path)) {
    try { unlinkSync(recording.path); } catch {}
  }
  deleteVideoRecordingRow(id);
}

export function getVideoFilename(recording: VideoRecording): string {
  return recording.path ? basename(recording.path) : `${safeName(recording.name)}.${recording.format}`;
}
