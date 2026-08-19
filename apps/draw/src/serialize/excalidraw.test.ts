import { describe, expect, test } from "bun:test";
import { EXCALIDRAW_SOURCE, fromExcalidraw, toExcalidraw } from "./excalidraw.js";
import { addElement, addStroke, createScene } from "../model/scene.js";

function seedScene() {
  let scene = createScene({ background: "#fafafa" });
  scene = addStroke(scene, [
    [0, 0],
    [10, 20],
  ], { strokeColor: "#111", strokeWidth: 2 });
  scene = addElement(scene, {
    type: "rectangle",
    x: 40,
    y: 10,
    width: 60,
    height: 30,
    backgroundColor: "#eee",
  });
  return scene;
}

describe("toExcalidraw", () => {
  test("produces a valid excalidraw file envelope", () => {
    const file = toExcalidraw(seedScene());
    expect(file.type).toBe("excalidraw");
    expect(file.version).toBe(2);
    expect(file.source).toBe(EXCALIDRAW_SOURCE);
    expect(file.appState.viewBackgroundColor).toBe("#fafafa");
    expect(file.files).toEqual({});
    expect(file.elements).toHaveLength(2);
    expect(file.elements[0]!.type).toBe("freedraw");
    expect(file.elements[0]!.strokeColor).toBe("#111");
  });

  test("defaults the background when the scene has none", () => {
    const file = toExcalidraw(createScene());
    expect(file.appState.viewBackgroundColor).toBe("#ffffff");
  });

  test("does not share mutable point or pressure arrays with the scene", () => {
    const scene = addStroke(createScene(), [[0, 0], [10, 20]], { pressures: [0.1, 0.9] });
    const file = toExcalidraw(scene);
    scene.elements[0]!.points![0] = [99, 99];
    scene.elements[0]!.pressures![0] = 0.99;
    expect(file.elements[0]!.points).toEqual([
      [0, 0],
      [10, 20],
    ]);
    expect(file.elements[0]!.pressures).toEqual([0.1, 0.9]);
  });

  test("omits the points key when the element has no points", () => {
    const scene = addElement(createScene(), { type: "rectangle", x: 0, y: 0, width: 5, height: 5 });
    const file = toExcalidraw(scene);
    expect(file.elements[0]!.points).toBeUndefined();
  });
});

describe("fromExcalidraw", () => {
  test("round-trips a scene through the excalidraw shape", () => {
    const scene = seedScene();
    const back = fromExcalidraw(toExcalidraw(scene));
    expect(back.elements).toHaveLength(2);
    expect(back.background).toBe("#fafafa");
    expect(back.elements[0]!.type).toBe("freedraw");
    expect(back.elements[0]!.points).toEqual([
      [0, 0],
      [10, 20],
    ]);
    expect(back.elements[1]!.type).toBe("rectangle");
    expect(back.elements[1]!.width).toBe(60);
  });

  test("parses a JSON string", () => {
    const json = JSON.stringify(toExcalidraw(seedScene()));
    expect(fromExcalidraw(json).elements).toHaveLength(2);
  });

  test("drops unknown element types", () => {
    const scene = fromExcalidraw({
      type: "excalidraw",
      elements: [
        { type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
        { type: "image", x: 0, y: 0, width: 10, height: 10 },
        { type: "frame", x: 0, y: 0, width: 10, height: 10 },
      ],
    });
    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0]!.type).toBe("rectangle");
  });

  test("accepts a bare elements array", () => {
    const scene = fromExcalidraw([{ type: "ellipse", x: 1, y: 2, width: 3, height: 4 }]);
    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0]!.type).toBe("ellipse");
  });

  test("returns an empty scene for junk input", () => {
    expect(fromExcalidraw(null).elements).toHaveLength(0);
    expect(fromExcalidraw(42).elements).toHaveLength(0);
  });

  test("round-trips text, fontSize, and fontFamily (Sol-guided)", () => {
    let scene = createScene();
    scene = addElement(scene, {
      type: "text",
      x: 10,
      y: 20,
      width: 0,
      height: 0,
      text: "hello",
      fontSize: 24,
      fontFamily: 2,
    });
    const back = fromExcalidraw(toExcalidraw(scene));
    const el = back.elements[0]!;
    expect(el.type).toBe("text");
    expect(el.text).toBe("hello");
    expect(el.fontSize).toBe(24);
    expect(el.fontFamily).toBe(2);
  });

  test("malformed JSON propagates the documented SyntaxError (Sol-guided)", () => {
    // The interchange contract documents JSON.parse semantics: a broken
    // document must throw, never be silently pinned to an empty scene.
    expect(() => fromExcalidraw("{not json")).toThrow(SyntaxError);
    // Positive arm: valid JSON still parses.
    expect(fromExcalidraw('{"elements":[]}').elements).toHaveLength(0);
  });

  test("scene width/height drop contract: not carried into the file (Sol-guided)", () => {
    // The current implementation intentionally drops scene width/height on
    // the excalidraw bridge (only background survives via appState). This
    // pins that drop explicitly so a future round-trip change is a visible
    // contract change, not a silent one.
    const scene = createScene({ width: 400, height: 300 });
    const file = toExcalidraw(scene);
    expect(file.appState).not.toHaveProperty("width");
    expect(file.appState).not.toHaveProperty("height");
    expect("width" in file).toBe(false);
    expect("height" in file).toBe(false);
    // The negative arm: elements still carry their own geometry.
    const withEl = addElement(scene, { type: "rectangle", x: 0, y: 0, width: 10, height: 5 });
    expect(toExcalidraw(withEl).elements[0]!.width).toBe(10);
  });

  // Edge cases preserved from the shared-checkout hygiene corpus, merged
  // alongside the Sol-guided suite that landed on main.
  test("assigns el-<index> ids to elements missing an id", () => {
    const scene = fromExcalidraw({
      elements: [
        { type: "rectangle", x: 0, y: 0, width: 1, height: 1 },
        { id: "", type: "ellipse", x: 0, y: 0, width: 1, height: 1 },
      ],
    });
    expect(scene.elements[0]!.id).toBe("el-0");
    expect(scene.elements[1]!.id).toBe("el-1");
  });

  test("coerces malformed points to zero-based coordinates", () => {
    const scene = fromExcalidraw({
      elements: [
        {
          type: "freedraw",
          points: [
            [1, 2],
            ["a", null],
            [3, 4, 5],
          ],
        },
      ],
    });
    expect(scene.elements[0]!.points).toEqual([
      [1, 2],
      [0, 0],
      [3, 4],
    ]);
  });

  test("drops a non array points field", () => {
    const scene = fromExcalidraw({ elements: [{ type: "freedraw", points: "junk" }] });
    expect(scene.elements[0]!.points).toBeUndefined();
  });

  test("an object with a non-array elements field yields an empty scene", () => {
    const scene = fromExcalidraw({ elements: "junk" });
    expect(scene.elements).toHaveLength(0);
  });

  test("ignores a non string viewBackgroundColor", () => {
    const scene = fromExcalidraw({ appState: { viewBackgroundColor: 42 } });
    expect(scene.background).toBeUndefined();
  });
});
