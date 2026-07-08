import { describe, expect, test } from "bun:test";
import {
  BOARD_SCHEMA,
  BOARD_VERSION,
  BoardValidationError,
  parseBoard,
  serializeBoard,
  toBoardDocument,
} from "./board.js";
import { addCard } from "../ops/cards.js";
import { drawing, note } from "../model/card.js";
import { createBoard } from "../model/board.js";
import { addElement, addStroke, createScene } from "../model/scene.js";

function seed() {
  let board = createBoard({ title: "Roundtrip" }).toJSON();
  board = addCard(board, note({ title: "N", text: "hello\nworld", color: "yellow", labels: ["x"] }));
  board = addCard(board, drawing({ title: "D", scene: addStroke(createScene(), [[0, 0], [5, 9]]) }));
  return board;
}

describe("toBoardDocument", () => {
  test("wraps the board in a versioned envelope", () => {
    const doc = toBoardDocument(seed());
    expect(doc.schema).toBe(BOARD_SCHEMA);
    expect(doc.version).toBe(BOARD_VERSION);
    expect(doc.board.cards).toHaveLength(2);
  });
});

describe("serializeBoard / parseBoard", () => {
  test("round-trips a board through JSON", () => {
    const board = seed();
    const json = serializeBoard(board);
    const back = parseBoard(json);
    expect(back.title).toBe("Roundtrip");
    expect(back.cards).toHaveLength(2);
    expect(back.cards[0]!.text).toBe("hello\nworld");
    expect(back.cards[0]!.color).toBe("yellow");
    expect(back.cards[1]!.kind).toBe("drawing");
    expect(back.cards[1]!.scene!.elements).toHaveLength(1);
    expect(back.cards[1]!.scene!.elements[0]!.type).toBe("freedraw");
  });

  test("pretty printing produces indented JSON", () => {
    const json = serializeBoard(seed(), true);
    expect(json).toContain("\n  ");
  });

  test("parses a bare board object (no envelope)", () => {
    const bare = seed();
    const back = parseBoard(bare);
    expect(back.cards).toHaveLength(2);
  });

  test("coerces defaults for a minimal board", () => {
    const back = parseBoard({ cards: [{ kind: "note" }] });
    expect(back.id).toBeString();
    expect(back.cards[0]!.text).toBe("");
    expect(back.createdAt).toBeString();
  });

  test("throws on invalid JSON", () => {
    expect(() => parseBoard("{not json")).toThrow(BoardValidationError);
  });

  test("throws on non-object input", () => {
    expect(() => parseBoard(42)).toThrow(BoardValidationError);
  });

  test("preserves full element fidelity on a drawing card round-trip", () => {
    let scene = createScene({ background: "#123456", width: 400, height: 300 });
    scene = addElement(scene, {
      type: "rectangle",
      x: 5,
      y: 6,
      width: 40,
      height: 20,
      angle: 0.5,
      strokeColor: "#f00",
      backgroundColor: "#0f0",
      fillStyle: "hachure",
      strokeWidth: 3,
      roughness: 2,
      opacity: 70,
      seed: 12345,
    });
    scene = addStroke(scene, [[0, 0], [3, 4]], { strokeColor: "#00f", pressures: [0.2, 0.8] });
    const board = addCard(createBoard().toJSON(), drawing({ scene }));

    const back = parseBoard(serializeBoard(board));
    const el = back.cards[0]!.scene!.elements[0]!;
    expect(back.cards[0]!.scene!.background).toBe("#123456");
    expect(back.cards[0]!.scene!.width).toBe(400);
    expect(el.angle).toBe(0.5);
    expect(el.strokeColor).toBe("#f00");
    expect(el.backgroundColor).toBe("#0f0");
    expect(el.fillStyle).toBe("hachure");
    expect(el.strokeWidth).toBe(3);
    expect(el.roughness).toBe(2);
    expect(el.opacity).toBe(70);
    expect(el.seed).toBe(12345);
    const stroke = back.cards[0]!.scene!.elements[1]!;
    expect(stroke.pressures).toEqual([0.2, 0.8]);
  });
});
