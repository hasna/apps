import { describe, expect, test } from "bun:test";
import { BoardModel, createBoard, loadBoard } from "./board.js";
import { addStroke, createScene } from "./scene.js";
import { fromExcalidraw, toExcalidraw } from "../serialize/excalidraw.js";

describe("createBoard", () => {
  test("creates an empty board with an id", () => {
    const board = createBoard({ title: "Ideas" });
    expect(board).toBeInstanceOf(BoardModel);
    expect(board.title).toBe("Ideas");
    expect(board.id).toBeString();
    expect(board.cards).toHaveLength(0);
  });
});

describe("chainable mutations", () => {
  test("addNote and addDrawing are chainable", () => {
    const board = createBoard()
      .addNote({ title: "Todo", text: "ship it" })
      .addDrawing({ title: "Doodle" });
    expect(board.cards).toHaveLength(2);
    expect(board.cards[0]!.kind).toBe("note");
    expect(board.cards[1]!.kind).toBe("drawing");
  });

  test("update, pin, archive, setColor, reorder, remove", () => {
    const board = createBoard().addNote({ text: "a" }).addNote({ text: "b" });
    const first = board.cards[0]!.id;
    board.update(first, { text: "changed" }).pin(first, true).setColor(first, "blue");
    const updated = board.card(first)!;
    expect(updated.text).toBe("changed");
    expect(updated.pinned).toBe(true);
    expect(updated.color).toBe("blue");

    board.archive(first, true);
    expect(board.card(first)!.archived).toBe(true);

    const second = board.cards.find((c) => c.id !== first)!.id;
    board.reorder(second, 0);
    const ordered = board.query({ archived: undefined }, "order");
    expect(ordered.length).toBeGreaterThan(0);

    board.remove(first);
    expect(board.card(first)).toBeUndefined();
  });

  test("query and stats reflect current state", () => {
    const board = createBoard().addNote({ text: "x", color: "red" }).addDrawing({});
    expect(board.stats().total).toBe(2);
    expect(board.stats().drawings).toBe(1);
    expect(board.query({ color: "red" })).toHaveLength(1);
  });
});

describe("serialization round-trip", () => {
  test("note and drawing cards round-trip through serialize/loadBoard", () => {
    const scene = addStroke(createScene(), [[0, 0], [10, 10], [20, 5]]);
    const original = createBoard({ title: "Trip" })
      .addNote({ title: "N", text: "line1\nline2", color: "green", labels: ["l"] })
      .addDrawing({ title: "D", scene });

    const json = original.serialize(true);
    const back = loadBoard(json);

    expect(back.title).toBe("Trip");
    expect(back.cards).toHaveLength(2);
    const noteCard = back.cards.find((c) => c.kind === "note")!;
    expect(noteCard.text).toBe("line1\nline2");
    expect(noteCard.color).toBe("green");
    expect(noteCard.labels).toEqual(["l"]);
    const drawCard = back.cards.find((c) => c.kind === "drawing")!;
    expect(drawCard.scene!.elements).toHaveLength(1);
  });

  test("drawing scene round-trips through the excalidraw bridge", () => {
    const scene = addStroke(createScene(), [[0, 0], [10, 10], [20, 5]]);
    const back = fromExcalidraw(toExcalidraw(scene));
    expect(back.elements).toHaveLength(1);
    expect(back.elements[0]!.type).toBe("freedraw");
    expect(back.elements[0]!.points).toEqual(scene.elements[0]!.points!);
  });

  test("toJSON returns an independent copy", () => {
    const board = createBoard().addNote({ text: "a" });
    const data = board.toJSON();
    data.cards[0]!.text = "mutated";
    expect(board.cards[0]!.text).toBe("a");
  });
});
