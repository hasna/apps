import { describe, expect, test } from "bun:test";
import { addElement, addStroke, createScene } from "../model/scene.js";
import type { DrawElement } from "../types/index.js";
import {
  cn,
  elementToShape,
  opacityOf,
  pointsToPath,
  sceneViewBox,
  strokeOf,
  strokeWidthOf,
} from "./svg.js";

describe("cn", () => {
  test("joins truthy parts and drops falsey ones", () => {
    expect(cn("a", false, undefined, "b", null, "")).toBe("a b");
  });
});

describe("pointsToPath", () => {
  test("returns empty string with no points", () => {
    expect(pointsToPath([])).toBe("");
  });

  test("builds a move + line path with an origin offset", () => {
    expect(
      pointsToPath(
        [
          [0, 0],
          [10, 5],
        ],
        100,
        200,
      ),
    ).toBe("M 100 200 L 110 205");
  });

  test("rounds fractional points to two decimals (Sol-guided rounding contract)", () => {
    // Positive arm: exact values pass through untouched.
    expect(pointsToPath([[0.25, 0.5]])).toBe("M 0.25 0.5");
    // Rounding arm: 10.125 -> 10.13, 5.375 -> 5.38, 1.999 -> 2 (kept compact).
    expect(pointsToPath([[10.125, 5.375], [1.999, 2.5]])).toBe("M 10.13 5.38 L 2 2.5");
  });
});

describe("sceneViewBox", () => {
  test("falls back to declared size for an empty scene", () => {
    expect(sceneViewBox(createScene({ width: 320, height: 180 }))).toBe("0 0 320 180");
  });

  test("fits and pads a scene's content", () => {
    const scene = addStroke(createScene(), [
      [10, 10],
      [30, 50],
    ]);
    expect(sceneViewBox(scene, 5)).toBe("5 5 30 50");
  });

  test("pads negative coordinates into the viewBox (Sol-guided negative-origin arm)", () => {
    const scene = addElement(createScene(), {
      type: "rectangle",
      x: -40,
      y: -30,
      width: 20,
      height: 10,
    });
    // Positive arm: a scene fully inside the origin pads from 0 0.
    expect(sceneViewBox(createScene({ width: 100, height: 100 }))).toBe("0 0 100 100");
    // Negative arm: padding pushes the viewBox origin negative and keeps
    // the padded dimensions exact.
    expect(sceneViewBox(scene, 8)).toBe("-48 -38 36 26");
  });
});

describe("element accessors", () => {
  const base: DrawElement = { id: "e1", type: "freedraw", x: 0, y: 0, width: 0, height: 0 };

  test("strokeOf falls back and honors overrides", () => {
    expect(strokeOf(base, "#000")).toBe("#000");
    expect(strokeOf({ ...base, strokeColor: "#f00" })).toBe("#f00");
  });

  test("strokeWidthOf falls back and honors overrides", () => {
    expect(strokeWidthOf(base)).toBe(2);
    expect(strokeWidthOf({ ...base, strokeWidth: 6 })).toBe(6);
  });

  test("opacityOf normalizes 0..100 to 0..1", () => {
    expect(opacityOf(base)).toBe(1);
    expect(opacityOf({ ...base, opacity: 50 })).toBe(0.5);
    expect(opacityOf({ ...base, opacity: 0.25 })).toBe(0.25);
  });

  test("opacityOf maps stored opacity 1 to 0.01, not 1 (Sol-guided red regression)", () => {
    // Scene opacity is stored 0..100: 1 means 1% opacity. The current
    // implementation treats 1 as an already-normalized fraction (1 = 100%)
    // because the `> 1` percent branch does not fire on 1 — a stroke saved
    // at 1% opacity renders fully opaque. This test failed against the
    // current code and is the guard for the fix.
    expect(opacityOf({ ...base, opacity: 1 })).toBe(0.01);
  });

  test("opacityOf boundary values map to their exact fractions", () => {
    expect(opacityOf({ ...base, opacity: 0 })).toBe(0);
    expect(opacityOf({ ...base, opacity: 50 })).toBe(0.5);
    expect(opacityOf({ ...base, opacity: 100 })).toBe(1);
  });
});

describe("elementToShape", () => {
  test("freedraw maps to an offset path", () => {
    const shape = elementToShape({
      id: "e1",
      type: "freedraw",
      x: 10,
      y: 20,
      width: 5,
      height: 5,
      points: [
        [0, 0],
        [5, 5],
      ],
    });
    expect(shape).toEqual({ kind: "path", d: "M 10 20 L 15 25" });
  });

  test("rectangle maps to a rect", () => {
    expect(
      elementToShape({ id: "e2", type: "rectangle", x: 1, y: 2, width: 3, height: 4 }),
    ).toEqual({ kind: "rect", x: 1, y: 2, width: 3, height: 4 });
  });

  test("ellipse maps to a centered ellipse", () => {
    expect(
      elementToShape({ id: "e3", type: "ellipse", x: 0, y: 0, width: 20, height: 10 }),
    ).toEqual({ kind: "ellipse", cx: 10, cy: 5, rx: 10, ry: 5 });
  });

  test("ellipse with zero or negative width/height clamps rx/ry to zero", () => {
    // Sol-guided boundary arm: a degenerate ellipse must not emit negative radii.
    expect(
      elementToShape({ id: "e3b", type: "ellipse", x: 0, y: 0, width: 0, height: 0 }),
    ).toEqual({ kind: "ellipse", cx: 0, cy: 0, rx: 0, ry: 0 });
    expect(
      elementToShape({ id: "e3c", type: "ellipse", x: 10, y: 10, width: -6, height: -4 }),
    ).toEqual({ kind: "ellipse", cx: 7, cy: 8, rx: 0, ry: 0 });
  });

  test("diamond maps to a 4 point polygon", () => {
    const shape = elementToShape({ id: "e4", type: "diamond", x: 0, y: 0, width: 10, height: 10 });
    expect(shape).toEqual({ kind: "polygon", points: "5,0 10,5 5,10 0,5" });
  });

  test("text maps to a baseline shifted text shape", () => {
    expect(
      elementToShape({
        id: "e5",
        type: "text",
        x: 4,
        y: 6,
        width: 0,
        height: 0,
        text: "hi",
        fontSize: 20,
      }),
    ).toEqual({ kind: "text", x: 4, y: 26, text: "hi", fontSize: 20 });
  });
});
