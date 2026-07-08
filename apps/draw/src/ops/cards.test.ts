import { describe, expect, test } from "bun:test";
import {
  addCard,
  archiveCard,
  deleteCard,
  pinCard,
  reorderCard,
  setCardColor,
  updateCard,
} from "./cards.js";
import { note } from "../model/card.js";
import { createBoard } from "../model/board.js";

function emptyBoard() {
  return createBoard().toJSON();
}

describe("addCard", () => {
  test("appends a card and assigns a dense order", () => {
    let board = emptyBoard();
    board = addCard(board, note({ text: "a" }));
    board = addCard(board, note({ text: "b" }));
    expect(board.cards).toHaveLength(2);
    expect(board.cards.map((c) => c.order)).toEqual([0, 1]);
  });

  test("is pure: does not mutate the input board", () => {
    const board = emptyBoard();
    const next = addCard(board, note());
    expect(board.cards).toHaveLength(0);
    expect(next.cards).toHaveLength(1);
  });

  test("bumps updatedAt", async () => {
    const board = emptyBoard();
    await Bun.sleep(2);
    const next = addCard(board, note());
    expect(next.updatedAt >= board.updatedAt).toBe(true);
  });
});

describe("updateCard", () => {
  test("applies a patch to the matching card", () => {
    let board = addCard(emptyBoard(), note({ text: "old" }));
    const id = board.cards[0]!.id;
    board = updateCard(board, id, { text: "new", color: "red" });
    expect(board.cards[0]!.text).toBe("new");
    expect(board.cards[0]!.color).toBe("red");
  });

  test("unknown id leaves the board unchanged", () => {
    const board = addCard(emptyBoard(), note());
    expect(updateCard(board, "nope", { text: "x" })).toBe(board);
  });
});

describe("deleteCard", () => {
  test("removes a card and re-densifies order", () => {
    let board = emptyBoard();
    board = addCard(board, note({ text: "a" }));
    board = addCard(board, note({ text: "b" }));
    board = addCard(board, note({ text: "c" }));
    const middle = board.cards[1]!.id;
    board = deleteCard(board, middle);
    expect(board.cards).toHaveLength(2);
    expect(board.cards.map((c) => c.order)).toEqual([0, 1]);
    expect(board.cards.map((c) => c.text)).toEqual(["a", "c"]);
  });

  test("unknown id is a no op", () => {
    const board = addCard(emptyBoard(), note());
    expect(deleteCard(board, "nope")).toBe(board);
  });
});

describe("reorderCard", () => {
  test("moves a card to a new index", () => {
    let board = emptyBoard();
    board = addCard(board, note({ text: "a" }));
    board = addCard(board, note({ text: "b" }));
    board = addCard(board, note({ text: "c" }));
    const last = board.cards[2]!.id;
    board = reorderCard(board, last, 0);
    const ordered = [...board.cards].sort((x, y) => x.order - y.order);
    expect(ordered.map((c) => c.text)).toEqual(["c", "a", "b"]);
    expect(ordered.map((c) => c.order)).toEqual([0, 1, 2]);
  });

  test("clamps out-of-range indices", () => {
    let board = emptyBoard();
    board = addCard(board, note({ text: "a" }));
    board = addCard(board, note({ text: "b" }));
    const first = board.cards[0]!.id;
    board = reorderCard(board, first, 99);
    const ordered = [...board.cards].sort((x, y) => x.order - y.order);
    expect(ordered.map((c) => c.text)).toEqual(["b", "a"]);
  });
});

describe("pinCard / archiveCard / setCardColor", () => {
  test("pinCard toggles when the flag is omitted", () => {
    let board = addCard(emptyBoard(), note());
    const id = board.cards[0]!.id;
    board = pinCard(board, id);
    expect(board.cards[0]!.pinned).toBe(true);
    board = pinCard(board, id);
    expect(board.cards[0]!.pinned).toBe(false);
  });

  test("archiveCard sets an explicit flag", () => {
    let board = addCard(emptyBoard(), note());
    const id = board.cards[0]!.id;
    board = archiveCard(board, id, true);
    expect(board.cards[0]!.archived).toBe(true);
  });

  test("setCardColor changes the color", () => {
    let board = addCard(emptyBoard(), note());
    const id = board.cards[0]!.id;
    board = setCardColor(board, id, "teal");
    expect(board.cards[0]!.color).toBe("teal");
  });
});
