import { describe, test, expect } from "bun:test";
import { getScaledSize, RECOMMENDED_WIDTHS } from "../src/lib/scale.js";

describe("scale", () => {
  test("RECOMMENDED_WIDTHS has expected values", () => {
    expect(RECOMMENDED_WIDTHS.xga).toBe(1024);
    expect(RECOMMENDED_WIDTHS.wxga).toBe(1280);
    expect(RECOMMENDED_WIDTHS.hd).toBe(1366);
  });

  test("getScaledSize returns original if within bounds", () => {
    const size = getScaledSize({ width: 1024, height: 768 }, 1280);
    expect(size.width).toBe(1024);
    expect(size.height).toBe(768);
  });

  test("getScaledSize scales down large displays", () => {
    const size = getScaledSize({ width: 2560, height: 1600 }, 1280);
    expect(size.width).toBe(1280);
    expect(size.height).toBe(800);
  });

  test("getScaledSize maintains aspect ratio", () => {
    const original = { width: 1920, height: 1080 };
    const scaled = getScaledSize(original, 1280);
    const originalRatio = original.width / original.height;
    const scaledRatio = scaled.width / scaled.height;
    expect(Math.abs(originalRatio - scaledRatio)).toBeLessThan(0.01);
  });

  test("getScaledSize with default maxWidth", () => {
    const size = getScaledSize({ width: 2560, height: 1600 });
    expect(size.width).toBe(1280);
  });

  test("getScaledSize at exact boundary", () => {
    const size = getScaledSize({ width: 1280, height: 800 }, 1280);
    expect(size.width).toBe(1280);
    expect(size.height).toBe(800);
  });
});
