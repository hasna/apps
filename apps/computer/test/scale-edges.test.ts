// Test-gap lane: agent-authored analysis (SOL consult refused — gpt-5.6-sol consult timed out twice within the 2x600s protocol bound; no answer delivered). Authored by Paulinus.
import { describe, expect, test } from "bun:test";
import { getScaledSize } from "../src/lib/scale.js";

describe("scale — getScaledSize edges", () => {
  test("1920x1080 scales to exactly 1280x720", () => {
    expect(getScaledSize({ width: 1920, height: 1080 }, 1280)).toEqual({ width: 1280, height: 720 });
  });

  test("1366x768 rounds 719.77 up to 720", () => {
    expect(getScaledSize({ width: 1366, height: 768 }, 1280)).toEqual({ width: 1280, height: 720 });
  });

  test("half-integer heights round up (JS Math.round)", () => {
    // 100x33 at maxWidth 50 → height = 33 * 0.5 = 16.5 → 17
    expect(getScaledSize({ width: 100, height: 33 }, 50)).toEqual({ width: 50, height: 17 });
  });

  test("maxWidth 0 produces a zero-size result", () => {
    expect(getScaledSize({ width: 1920, height: 1080 }, 0)).toEqual({ width: 0, height: 0 });
  });

  test("widths smaller than maxWidth are returned untouched, including degenerate ones", () => {
    expect(getScaledSize({ width: -100, height: 50 }, 1280)).toEqual({ width: -100, height: 50 });
  });

  test("square displays stay square when scaled", () => {
    expect(getScaledSize({ width: 2048, height: 2048 }, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  test("ultrawide keeps aspect ratio with rounding", () => {
    // 3440x1440 → 1280x536 (1440 * 1280/3440 = 535.8… → 536)
    expect(getScaledSize({ width: 3440, height: 1440 }, 1280)).toEqual({ width: 1280, height: 536 });
  });
});
