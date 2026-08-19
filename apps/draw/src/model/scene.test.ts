import { describe, expect, test } from "bun:test";
import {
  SCENE_SCHEMA,
  SCENE_VERSION,
  addElement,
  addStroke,
  clearScene,
  createScene,
  removeElement,
  sceneBounds,
} from "./scene.js";

describe("createScene", () => {
  test("makes an empty, versioned scene", () => {
    const scene = createScene();
    expect(scene.schema).toBe(SCENE_SCHEMA);
    expect(scene.version).toBe(SCENE_VERSION);
    expect(scene.elements).toEqual([]);
  });

  test("carries optional background and size", () => {
    const scene = createScene({ background: "#000", width: 800, height: 600 });
    expect(scene.background).toBe("#000");
    expect(scene.width).toBe(800);
    expect(scene.height).toBe(600);
  });
});

describe("addStroke", () => {
  test("adds a freedraw element with origin at the point-cloud top left", () => {
    const scene = addStroke(createScene(), [
      [10, 20],
      [30, 60],
      [15, 40],
    ]);
    expect(scene.elements).toHaveLength(1);
    const el = scene.elements[0]!;
    expect(el.type).toBe("freedraw");
    expect(el.id).toBeString();
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
    expect(el.width).toBe(20);
    expect(el.height).toBe(40);
    // points are stored relative to the element origin
    expect(el.points).toEqual([
      [0, 0],
      [20, 40],
      [5, 20],
    ]);
  });

  test("is pure: does not mutate the input scene", () => {
    const scene = createScene();
    const next = addStroke(scene, [[0, 0], [1, 1]]);
    expect(scene.elements).toHaveLength(0);
    expect(next.elements).toHaveLength(1);
  });

  test("passes through stroke options", () => {
    const scene = addStroke(createScene(), [[0, 0], [5, 5]], {
      strokeColor: "#f00",
      strokeWidth: 3,
      opacity: 80,
      pressures: [0.1, 0.9],
    });
    const el = scene.elements[0]!;
    expect(el.strokeColor).toBe("#f00");
    expect(el.strokeWidth).toBe(3);
    expect(el.opacity).toBe(80);
    expect(el.pressures).toEqual([0.1, 0.9]);
  });

  test("does not retain the caller's mutable pressure array", () => {
    const pressures = [0.1, 0.9];
    const scene = addStroke(createScene(), [[0, 0], [5, 5]], { pressures });

    pressures[0] = 0.5;

    expect(scene.elements[0]!.pressures).toEqual([0.1, 0.9]);
  });

  test("empty point list adds nothing", () => {
    const scene = addStroke(createScene(), []);
    expect(scene.elements).toHaveLength(0);
  });

  test("a single point becomes a zero sized element at that point", () => {
    const scene = addStroke(createScene(), [[5, 7]]);
    expect(scene.elements).toHaveLength(1);
    const el = scene.elements[0]!;
    expect(el.x).toBe(5);
    expect(el.y).toBe(7);
    expect(el.width).toBe(0);
    expect(el.height).toBe(0);
    expect(el.points).toEqual([[0, 0]]);
  });

  test("honors a caller supplied id", () => {
    const scene = addStroke(createScene(), [[0, 0], [1, 1]], { id: "stroke-1" });
    expect(scene.elements[0]!.id).toBe("stroke-1");
  });

  test("normalizes negative coordinates to the point-cloud top left", () => {
    const scene = addStroke(createScene(), [
      [-10, -20],
      [5, -5],
    ]);
    const el = scene.elements[0]!;
    expect(el.x).toBe(-10);
    expect(el.y).toBe(-20);
    expect(el.width).toBe(15);
    expect(el.height).toBe(15);
    expect(el.points).toEqual([
      [0, 0],
      [15, 15],
    ]);
  });

  test("is pure with respect to the caller's point arrays", () => {
    const points: [number, number][] = [[0, 0], [2, 2]];
    const scene = addStroke(createScene(), points);
    points[0] = [99, 99];
    expect(scene.elements[0]!.points).toEqual([
      [0, 0],
      [2, 2],
    ]);
  });
});

describe("addElement / removeElement / clearScene", () => {
  test("adds an element and generates a missing id", () => {
    const scene = addElement(createScene(), {
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    expect(scene.elements[0]!.id).toBeString();
    expect(scene.elements[0]!.type).toBe("rectangle");
  });

  test("removes an element by id", () => {
    const withEl = addElement(createScene(), {
      id: "keep-me",
      type: "ellipse",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const removed = removeElement(withEl, "keep-me");
    expect(removed.elements).toHaveLength(0);
  });

  test("removing an unknown id is a no op", () => {
    const withEl = addElement(createScene(), {
      type: "ellipse",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(removeElement(withEl, "nope").elements).toHaveLength(1);
  });

  test("keeps a caller supplied id", () => {
    const scene = addElement(createScene(), {
      id: "el-custom",
      type: "line",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    expect(scene.elements[0]!.id).toBe("el-custom");
  });

  test("addElement is pure: the input scene is untouched", () => {
    const scene = createScene();
    const next = addElement(scene, { type: "rectangle", x: 0, y: 0, width: 1, height: 1 });
    expect(scene.elements).toHaveLength(0);
    expect(next.elements).toHaveLength(1);
  });

  test("clearScene keeps background and size", () => {
    const scene = addStroke(createScene({ background: "#fff", width: 400, height: 300 }), [
      [0, 0],
      [1, 1],
    ]);
    const cleared = clearScene(scene);
    expect(cleared.elements).toHaveLength(0);
    expect(cleared.background).toBe("#fff");
    expect(cleared.width).toBe(400);
  });
});

describe("sceneBounds", () => {
  test("returns a zero box for an empty scene", () => {
    expect(sceneBounds(createScene())).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  test("computes the union bounding box", () => {
    let scene = createScene();
    scene = addElement(scene, { type: "rectangle", x: 10, y: 10, width: 20, height: 20 });
    scene = addElement(scene, { type: "rectangle", x: 50, y: 5, width: 10, height: 40 });
    expect(sceneBounds(scene)).toEqual({ x: 10, y: 5, width: 50, height: 40 });
  });

  test("computes bounds when elements cross the origin", () => {
    let scene = createScene();
    scene = addElement(scene, { type: "rectangle", x: -20, y: -10, width: 30, height: 15 });
    scene = addElement(scene, { type: "ellipse", x: 5, y: -4, width: 10, height: 20 });

    expect(sceneBounds(scene)).toEqual({ x: -20, y: -10, width: 35, height: 26 });
  });

  test("a zero sized element contributes a point box, not nothing", () => {
    const scene = addElement(createScene(), { type: "text", x: 40, y: 30, width: 0, height: 0 });
    expect(sceneBounds(scene)).toEqual({ x: 40, y: 30, width: 0, height: 0 });
  });

  test("bounds include an element with a negative width contribution", () => {
    // width may be negative on malformed input; the box must still span x..x+width.
    const scene = addElement(createScene(), { type: "rectangle", x: 10, y: 10, width: -4, height: 2 });
    expect(sceneBounds(scene)).toEqual({ x: 10, y: 10, width: -4, height: 2 });
  });
});
