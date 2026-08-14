import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildFrameTranscodeArgs,
  buildVideoTranscodeArgs,
  resolveVideoTranscodeSettings,
  validateVideoOutput,
} from "./video-recording.js";
import { buildX11FfmpegArgs } from "./x11-video.js";

describe("video transcode settings", () => {
  it("uses crisp H.264 settings for high quality MP4", () => {
    const settings = resolveVideoTranscodeSettings("mp4", "high", {});
    expect(settings).toMatchObject({
      codec: "h264",
      encoding: "crisp",
      crf: 12,
      ffmpegPreset: "slow",
    });

    const args = buildVideoTranscodeArgs("in.webm", "out.mp4", settings!);
    expect(args).toContain("-crf");
    expect(args).toContain("12");
    expect(args).toContain("-preset");
    expect(args).toContain("slow");
    expect(args).toContain("-tune");
    expect(args).toContain("animation");
  });

  it("supports explicit H.264 lossless output", () => {
    const settings = resolveVideoTranscodeSettings("mp4", "ultra", {
      encoding: "lossless",
    });
    const args = buildVideoTranscodeArgs("in.webm", "out.mp4", settings!);

    expect(args).toContain("-qp");
    expect(args).toContain("0");
    expect(args).toContain("high444");
    expect(args).toContain("yuv444p");
  });

  it("supports ProRes MOV output for Mac-style masters", () => {
    const settings = resolveVideoTranscodeSettings("mov", "ultra", {});
    expect(settings).toMatchObject({
      codec: "prores",
      encoding: "prores",
    });

    const args = buildVideoTranscodeArgs("in.webm", "out.mov", settings!);
    expect(args).toContain("prores_ks");
    expect(args).toContain("yuv422p10le");
    expect(args).toContain("apl0");
  });

  it("keeps explicit bitrate and preset overrides", () => {
    const settings = resolveVideoTranscodeSettings("mp4", "high", {
      crf: 10,
      videoBitrate: "40M",
      ffmpegPreset: "veryslow",
    });
    const args = buildVideoTranscodeArgs("in.webm", "out.mp4", settings!);

    expect(settings?.crf).toBe(10);
    expect(settings?.videoBitrate).toBe("40M");
    expect(settings?.ffmpegPreset).toBe("veryslow");
    expect(args).toContain("40M");
  });

  it("builds timed frame transcode args with output fps", () => {
    const settings = resolveVideoTranscodeSettings("mp4", "high", {
      captureMode: "cdp",
      fps: 60,
    });
    const args = buildFrameTranscodeArgs("frames.txt", "out.mp4", settings!);

    expect(settings?.fps).toBe(60);
    expect(args).toContain("-f");
    expect(args).toContain("concat");
    expect(args).toContain("-r");
    expect(args).toContain("60");
  });

  it("rejects incompatible ProRes and MP4 combinations", () => {
    expect(() =>
      resolveVideoTranscodeSettings("mp4", "high", { encoding: "prores" })
    ).toThrow("ProRes output requires format='mov'");
  });

  it("builds realtime X11 capture args for smooth browser recording", () => {
    const args = buildX11FfmpegArgs({
      display: ":99",
      width: 3840,
      height: 2160,
      fps: 60,
      format: "mp4",
      crf: 10,
      outputPath: "out.mp4",
    });

    expect(args).toContain("x11grab");
    expect(args).toContain("3840x2160");
    expect(args).toContain("60");
    expect(args).toContain("ultrafast");
    expect(args).toContain("zerolatency");
  });

  it("validates final video output before marking recordings complete", () => {
    const dir = mkdtempSync(join(tmpdir(), "browser-video-validate-"));
    try {
      const path = join(dir, "out.mp4");
      writeFileSync(path, Buffer.alloc(2048));

      expect(validateVideoOutput({
        path,
        width: 1920,
        height: 1080,
        expectedWidth: 1280,
        expectedHeight: 720,
      })).toMatchObject({
        ok: true,
        sizeBytes: 2048,
        width: 1920,
        height: 1080,
      });

      expect(() => validateVideoOutput({
        path,
        width: 640,
        height: 360,
        expectedWidth: 1280,
      })).toThrow(/below expected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
