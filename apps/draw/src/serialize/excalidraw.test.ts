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
});
