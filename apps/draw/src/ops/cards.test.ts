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
import { createScene } from "../model/scene.js";

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

  test("overrides a pre-existing order key with the next dense index", () => {
    const card = note({ text: "a" });
    card.order = 42;
    const next = addCard(emptyBoard(), card);
    expect(next.cards[0]!.order).toBe(0);
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

  test("a scene passed through the patch is deep copied into the board", () => {
    let board = addCard(emptyBoard(), note({ text: "seed" }));
    const id = board.cards[0]!.id;
    const scene = createScene();
    board = updateCard(board, id, { scene });
    scene.elements.push({ id: "x", type: "line", x: 0, y: 0, width: 0, height: 0 });
    expect(board.cards[0]!.scene!.elements).toHaveLength(0);
  });

  test("labels passed through the patch are copied, not shared", () => {
    let board = addCard(emptyBoard(), note());
    const id = board.cards[0]!.id;
    const labels = ["a"];
    board = updateCard(board, id, { labels });
    labels.push("b");
    expect(board.cards[0]!.labels).toEqual(["a"]);
  });

  test("a partial patch leaves unrelated card fields untouched", () => {
    let board = addCard(emptyBoard(), note({ text: "keep", color: "red", labels: ["x"], pinned: true }));
    const id = board.cards[0]!.id;
    board = updateCard(board, id, { text: "changed" });
    expect(board.cards[0]!.color).toBe("red");
    expect(board.cards[0]!.labels).toEqual(["x"]);
    expect(board.cards[0]!.pinned).toBe(true);
  });

  test("updateCard does not mutate the input board", () => {
    const board = addCard(emptyBoard(), note({ text: "a" }));
    const id = board.cards[0]!.id;
    updateCard(board, id, { text: "b" });
    expect(board.cards[0]!.text).toBe("a");
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

  test("reordering to the current index is a no op", () => {
    let board = emptyBoard();
    board = addCard(board, note({ text: "a" }));
    board = addCard(board, note({ text: "b" }));
    const before = board;
    const first = board.cards[0]!.id;
    expect(reorderCard(board, first, 0)).toBe(before);
  });

  test("reorder sorts by the order key first, tolerating out-of-order arrays", () => {
    let board = emptyBoard();
    board = addCard(board, note({ text: "a" }));
    board = addCard(board, note({ text: "b" }));
    board = addCard(board, note({ text: "c" }));
    // Scramble the array while keeping the order keys untouched.
    const scrambled: typeof board = { ...board, cards: [board.cards[2]!, board.cards[0]!, board.cards[1]!] };
    const lastId = scrambled.cards.find((c) => c.order === 2)!.id;
    const reordered = reorderCard(scrambled, lastId, 0);
    const ordered = [...reordered.cards].sort((x, y) => x.order - y.order);
    expect(ordered.map((c) => c.text)).toEqual(["c", "a", "b"]);
    expect(ordered.map((c) => c.order)).toEqual([0, 1, 2]);
  });

  test("reordering bumps the updatedAt of the moved card", async () => {
    let board = emptyBoard();
    board = addCard(board, note({ text: "a" }));
    board = addCard(board, note({ text: "b" }));
    const last = board.cards[1]!.id;
    const before = board.cards[1]!.updatedAt;
    await Bun.sleep(2);
    const reordered = reorderCard(board, last, 0);
    const moved = [...reordered.cards].sort((x, y) => x.order - y.order)[0]!;
    expect(moved.id).toBe(last);
    expect(moved.updatedAt >= before).toBe(true);
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

  test("pinCard with an explicit flag sets, not toggles", () => {
    let board = addCard(emptyBoard(), note({ pinned: true }));
    const id = board.cards[0]!.id;
    board = pinCard(board, id, true);
    expect(board.cards[0]!.pinned).toBe(true);
  });

  test("toggle operations on an unknown id are no ops", () => {
    const board = addCard(emptyBoard(), note());
    expect(pinCard(board, "nope")).toBe(board);
    expect(archiveCard(board, "nope")).toBe(board);
    expect(setCardColor(board, "nope", "red")).toBe(board);
  });

  test("deleting from a board with non-dense order keys re-densifies", () => {
    let b = emptyBoard();
    b = addCard(b, note({ text: "a" }));
    b = addCard(b, note({ text: "b" }));
    b = addCard(b, note({ text: "c" }));
    const scrambled: typeof b = {
      ...b,
      cards: [
        { ...b.cards[2]!, order: 5 },
        { ...b.cards[0]!, order: 0 },
        { ...b.cards[1]!, order: 3 },
      ],
    };
    const middleId = scrambled.cards[1]!.id;
    const next = deleteCard(scrambled, middleId);
    expect(next.cards.map((c) => c.order)).toEqual([0, 1]);
  });
});
