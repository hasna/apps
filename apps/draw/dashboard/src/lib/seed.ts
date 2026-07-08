import { addStroke, createBoard, createScene } from "@hasna/draw";
import type { Board, DrawScene } from "@hasna/draw";

/** A tiny freehand mountains + baseline sketch, built purely from the SDK. */
function sampleSketch(): DrawScene {
  let scene = createScene({ width: 300, height: 180 });
  scene = addStroke(
    scene,
    [
      [20, 130],
      [70, 50],
      [110, 110],
      [150, 40],
      [200, 130],
    ],
    { strokeColor: "#f59e0b", strokeWidth: 4 },
  );
  scene = addStroke(
    scene,
    [
      [16, 150],
      [220, 150],
    ],
    { strokeColor: "#9ca3af", strokeWidth: 2 },
  );
  return scene;
}

/** A generic sample board with a few notes and one drawing. */
export function seedBoard(): Board {
  return createBoard({ title: "Ideas board" })
    .addNote({
      title: "Shopping list",
      text: "Olive oil\nTomatoes\nFresh basil\nParmesan",
      color: "yellow",
      pinned: true,
      labels: ["home"],
    })
    .addDrawing({ title: "Logo sketch", scene: sampleSketch(), color: "orange", pinned: true })
    .addNote({
      title: "Release checklist",
      text: "Run the test suite\nBump the version\nWrite the changelog\nPublish",
      color: "green",
      labels: ["work"],
    })
    .addNote({ text: "Water the plants twice a week.", color: "blue" })
    .addNote({
      title: "Reading list",
      text: "Designing Data Intensive Applications\nThe Pragmatic Programmer",
      color: "purple",
      labels: ["learning"],
    })
    .toJSON();
}
