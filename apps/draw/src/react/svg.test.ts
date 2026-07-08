import { describe, expect, test } from "bun:test";
import { addStroke, createScene } from "../model/scene.js";
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
