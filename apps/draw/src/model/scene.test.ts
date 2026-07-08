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

  test("empty point list adds nothing", () => {
    const scene = addStroke(createScene(), []);
    expect(scene.elements).toHaveLength(0);
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
});
