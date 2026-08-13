import { describe, expect, it } from "bun:test";
import { resolveVideoRecordingPreset } from "./video-presets.js";

describe("video presets", () => {
  it("resolves X square to a readable social canvas", () => {
    const preset = resolveVideoRecordingPreset({ preset: "x-square" });

    expect(preset.width).toBe(1200);
    expect(preset.height).toBe(1200);
    expect(preset.tuiTheme).toBe("light");
    expect(preset.tuiFontSize).toBe(30);
    expect(preset.tuiFrame.enabled).toBe(true);
    expect(preset.tuiFrame.width).toBe(1040);
    expect(preset.tuiFrame.height).toBe(760);
  });

  it("keeps preset defaults when CLI passes absent frame values", () => {
    const preset = resolveVideoRecordingPreset({
      preset: "x-square",
      tuiFrame: {
        enabled: true,
        title: undefined,
        width: undefined,
      },
    });

    expect(preset.tuiFrame.title).toBe("Codewith");
    expect(preset.tuiFrame.width).toBe(1040);
  });

  it("allows explicit size and frame overrides", () => {
    const preset = resolveVideoRecordingPreset({
      preset: "reels",
      width: 1440,
      height: 2560,
      tuiFontSize: 40,
      tuiFrame: {
        fit: "canvas",
        width: 1200,
        height: 1100,
        background: "#ffffff",
      },
    });

    expect(preset.width).toBe(1440);
    expect(preset.height).toBe(2560);
    expect(preset.tuiFontSize).toBe(40);
    expect(preset.tuiFrame.fit).toBe("canvas");
    expect(preset.tuiFrame.width).toBe(1200);
    expect(preset.tuiFrame.height).toBe(1100);
    expect(preset.tuiFrame.background).toBe("#ffffff");
  });

  it("defaults frame fit to preset", () => {
    const preset = resolveVideoRecordingPreset({ preset: "x-square" });

    expect(preset.tuiFrame.fit).toBe("preset");
  });

  it("normalizes TUI zoom", () => {
    expect(resolveVideoRecordingPreset({ tuiZoom: 0.85 }).tuiZoom).toBe(0.85);
    expect(resolveVideoRecordingPreset({ tuiZoom: 0.1 }).tuiZoom).toBe(0.5);
    expect(resolveVideoRecordingPreset({ tuiZoom: 3 }).tuiZoom).toBe(2);
  });

  it("rejects invalid preset names for SDK callers too", () => {
    expect(() => resolveVideoRecordingPreset({ preset: "bad" as never })).toThrow(/Unknown video preset/);
  });
});
