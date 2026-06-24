import { describe, expect, test } from "bun:test";
import {
  clampPointToSpace,
  coordinateSpaceFromBounds,
  mapActionBetweenSpaces,
  mapPointBetweenSpaces,
} from "../src/lib/coordinates.js";
import type { CoordinateSpace, DriverAction, ScreenBounds } from "../src/types/index.js";

describe("coordinate transforms", () => {
  test("maps 1x screenshot coordinates without changing the point", () => {
    expect(mapPointBetweenSpaces(
      { x: 320, y: 240 },
      { width: 1280, height: 800 },
      { width: 1280, height: 800 },
    )).toEqual({ x: 320, y: 240 });
  });

  test("maps 2x scaled screenshot coordinates to native display coordinates", () => {
    const action: DriverAction = { type: "click", point: { x: 640, y: 400 }, button: "left" };

    expect(mapActionBetweenSpaces(
      action,
      { kind: "scaled_screenshot", size: { width: 1280, height: 800 } },
      { kind: "native_display", size: { width: 2560, height: 1600 } },
    )).toEqual({ type: "click", point: { x: 1280, y: 800 }, button: "left" });
    expect(action).toEqual({ type: "click", point: { x: 640, y: 400 }, button: "left" });
  });

  test("maps arbitrary scaled-width screenshots with independent x and y ratios", () => {
    expect(mapPointBetweenSpaces(
      { x: 1000, y: 500 },
      { kind: "scaled_screenshot", size: { width: 1280, height: 720 } },
      { kind: "native_display", size: { width: 1920, height: 1080 } },
    )).toEqual({ x: 1500, y: 750 });
  });

  test("maps local secondary-display screenshot points into global native coordinates", () => {
    const secondary: ScreenBounds = { x: 1920, y: 0, width: 1440, height: 900, displayNumber: 2 };

    expect(mapActionBetweenSpaces(
      { type: "drag", from: { x: 10, y: 20 }, to: { x: 1439, y: 899 } },
      { kind: "screenshot", size: { width: 1440, height: 900 }, displayNumber: 2 },
      coordinateSpaceFromBounds(secondary),
    )).toEqual({
      type: "drag",
      from: { x: 1930, y: 20 },
      to: { x: 3359, y: 899 },
    });
  });

  test("maps browser viewport coordinates into a native viewport rectangle", () => {
    const browserScreenshot: CoordinateSpace = {
      kind: "browser_viewport",
      size: { width: 800, height: 600 },
    };
    const nativeViewport: CoordinateSpace = {
      kind: "native_display",
      origin: { x: 100, y: 80 },
      size: { width: 1600, height: 1200 },
    };

    expect(mapPointBetweenSpaces({ x: 400, y: 300 }, browserScreenshot, nativeViewport)).toEqual({
      x: 900,
      y: 680,
    });
  });

  test("clamps mapped coordinates to the target display bounds when requested", () => {
    expect(mapPointBetweenSpaces(
      { x: 1280, y: 800 },
      { kind: "scaled_screenshot", size: { width: 1280, height: 800 } },
      { kind: "native_display", size: { width: 2560, height: 1600 } },
      { clamp: true },
    )).toEqual({ x: 2559, y: 1599 });

    expect(clampPointToSpace(
      { x: 100, y: -10 },
      { kind: "native_display", origin: { x: 50, y: 50 }, size: { width: 200, height: 100 } },
    )).toEqual({ x: 100, y: 50 });
  });
});
