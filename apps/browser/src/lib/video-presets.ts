import type {
  VideoRecordingOptions,
  VideoRecordingPreset,
  VideoRecordingQuality,
  VideoTuiFrameOptions,
} from "../types/index.js";
import { BrowserError } from "../types/index.js";

export interface ResolvedVideoPreset {
  preset: VideoRecordingPreset;
  quality: VideoRecordingQuality;
  width?: number;
  height?: number;
  tuiTheme?: "dark" | "light" | "system";
  tuiFontSize?: number;
  tuiZoom?: number;
  tuiFrame: VideoTuiFrameOptions;
}

interface VideoPresetDefaults {
  quality?: VideoRecordingQuality;
  width?: number;
  height?: number;
  tuiTheme?: "dark" | "light" | "system";
  tuiFontSize?: number;
  tuiZoom?: number;
  tuiFrame?: VideoTuiFrameOptions;
}

export const VIDEO_PRESET_NAMES: VideoRecordingPreset[] = [
  "source",
  "square",
  "vertical",
  "landscape",
  "x-square",
  "x-vertical",
  "x-landscape",
  "reels",
  "tiktok",
];

const PRESETS: Record<VideoRecordingPreset, VideoPresetDefaults> = {
  source: {
    quality: "source",
    tuiFrame: { enabled: false },
  },
  square: {
    quality: "high",
    width: 1080,
    height: 1080,
    tuiTheme: "light",
    tuiFontSize: 28,
    tuiFrame: {
      enabled: true,
      width: 940,
      height: 700,
      padding: 70,
      borderRadius: 18,
      title: "Codewith",
      background: "#f4f5f7",
      shadow: true,
    },
  },
  "x-square": {
    quality: "high",
    width: 1200,
    height: 1200,
    tuiTheme: "light",
    tuiFontSize: 30,
    tuiFrame: {
      enabled: true,
      width: 1040,
      height: 760,
      padding: 80,
      borderRadius: 20,
      title: "Codewith",
      background: "#f4f5f7",
      shadow: true,
    },
  },
  vertical: {
    quality: "high",
    width: 1080,
    height: 1920,
    tuiTheme: "light",
    tuiFontSize: 30,
    tuiFrame: {
      enabled: true,
      width: 940,
      height: 900,
      padding: 70,
      borderRadius: 20,
      title: "Codewith",
      background: "#f4f5f7",
      shadow: true,
    },
  },
  "x-vertical": {
    quality: "high",
    width: 1080,
    height: 1920,
    tuiTheme: "light",
    tuiFontSize: 30,
    tuiFrame: {
      enabled: true,
      width: 940,
      height: 900,
      padding: 70,
      borderRadius: 20,
      title: "Codewith",
      background: "#f4f5f7",
      shadow: true,
    },
  },
  reels: {
    quality: "high",
    width: 1080,
    height: 1920,
    tuiTheme: "light",
    tuiFontSize: 30,
    tuiFrame: {
      enabled: true,
      width: 940,
      height: 900,
      padding: 70,
      borderRadius: 20,
      title: "Codewith",
      background: "#f4f5f7",
      shadow: true,
    },
  },
  tiktok: {
    quality: "high",
    width: 1080,
    height: 1920,
    tuiTheme: "light",
    tuiFontSize: 30,
    tuiFrame: {
      enabled: true,
      width: 940,
      height: 900,
      padding: 70,
      borderRadius: 20,
      title: "Codewith",
      background: "#f4f5f7",
      shadow: true,
    },
  },
  landscape: {
    quality: "high",
    width: 1920,
    height: 1080,
    tuiTheme: "light",
    tuiFontSize: 28,
    tuiFrame: {
      enabled: true,
      width: 1600,
      height: 820,
      padding: 90,
      borderRadius: 18,
      title: "Codewith",
      background: "#f4f5f7",
      shadow: true,
    },
  },
  "x-landscape": {
    quality: "high",
    width: 1920,
    height: 1080,
    tuiTheme: "light",
    tuiFontSize: 28,
    tuiFrame: {
      enabled: true,
      width: 1600,
      height: 820,
      padding: 90,
      borderRadius: 18,
      title: "Codewith",
      background: "#f4f5f7",
      shadow: true,
    },
  },
};

function normalizePositive(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Math.round(value as number));
}

function normalizeZoom(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0.5, Math.min(2, value as number));
}

function compactFrameOptions(input: VideoTuiFrameOptions | undefined): VideoTuiFrameOptions {
  const output: VideoTuiFrameOptions = {};
  if (!input) return output;
  if (input.enabled !== undefined) output.enabled = input.enabled;
  if (input.fit !== undefined) output.fit = input.fit;
  if (input.width !== undefined) output.width = input.width;
  if (input.height !== undefined) output.height = input.height;
  if (input.padding !== undefined) output.padding = input.padding;
  if (input.borderRadius !== undefined) output.borderRadius = input.borderRadius;
  if (input.title !== undefined) output.title = input.title;
  if (input.background !== undefined) output.background = input.background;
  if (input.shadow !== undefined) output.shadow = input.shadow;
  return output;
}

export function resolveVideoRecordingPreset(opts: VideoRecordingOptions = {}): ResolvedVideoPreset {
  const presetName = opts.preset ?? "source";
  if (!VIDEO_PRESET_NAMES.includes(presetName)) {
    throw new BrowserError(
      `Unknown video preset "${presetName}". Expected one of: ${VIDEO_PRESET_NAMES.join(", ")}`,
      "VIDEO_PRESET_INVALID",
    );
  }
  const preset = PRESETS[presetName];
  const mergedFrame: VideoTuiFrameOptions = {
    ...preset.tuiFrame,
    ...compactFrameOptions(opts.tuiFrame),
  };

  return {
    preset: presetName,
    quality: opts.quality ?? preset.quality ?? "source",
    width: normalizePositive(opts.width ?? preset.width),
    height: normalizePositive(opts.height ?? preset.height),
    tuiTheme: opts.tuiTheme ?? preset.tuiTheme,
    tuiFontSize: normalizePositive(opts.tuiFontSize ?? preset.tuiFontSize),
    tuiZoom: normalizeZoom(opts.tuiZoom ?? preset.tuiZoom ?? 1),
    tuiFrame: {
      ...mergedFrame,
      fit: mergedFrame.fit ?? "preset",
      width: normalizePositive(mergedFrame.width),
      height: normalizePositive(mergedFrame.height),
      padding: normalizePositive(mergedFrame.padding),
      borderRadius: normalizePositive(mergedFrame.borderRadius),
    },
  };
}
