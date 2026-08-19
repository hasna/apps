import { describe, expect, test } from "bun:test";
import { boardStats, listCards, searchBoard } from "./query.js";
import { addCard } from "../ops/cards.js";
import { drawing, note } from "../model/card.js";
import { createBoard } from "../model/board.js";

function seed() {
  let board = createBoard({ title: "Test" }).toJSON();
  board = addCard(board, note({ title: "Alpha", text: "buy milk", color: "red", labels: ["shop"] }));
  board = addCard(board, drawing({ title: "Sketch" }));
  board = addCard(board, note({ title: "Beta", text: "call dentist", pinned: true }));
  board = addCard(board, note({ title: "Gamma", text: "archived note" }));
  // archived is not part of AddNoteInput; set it explicitly on the last card
  board.cards[3]!.archived = true;
  return board;
}

describe("listCards", () => {
  test("hides archived by default", () => {
    const cards = listCards(seed());
    expect(cards.every((c) => !c.archived)).toBe(true);
    expect(cards).toHaveLength(3);
  });

  test("floats pinned cards to the top", () => {
    const cards = listCards(seed());
    expect(cards[0]!.pinned).toBe(true);
    expect(cards[0]!.title).toBe("Beta");
  });

  test("filters by kind", () => {
    const cards = listCards(seed(), { kind: "drawing" });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.title).toBe("Sketch");
  });

  test("filters by color and label", () => {
    expect(listCards(seed(), { color: "red" })).toHaveLength(1);
    expect(listCards(seed(), { label: "shop" })).toHaveLength(1);
  });

  test("filters by search across title and text", () => {
    expect(listCards(seed(), { search: "milk" })).toHaveLength(1);
    expect(listCards(seed(), { search: "ALPHA" })).toHaveLength(1);
  });

  test("shows only archived when requested", () => {
    const cards = listCards(seed(), { archived: true });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.title).toBe("Gamma");
  });

  test("returns deep copies", () => {
    const board = seed();
    const cards = listCards(board);
    cards[0]!.title = "mutated";
    expect(board.cards.some((c) => c.title === "mutated")).toBe(false);
  });

  test("filters pinned:false to unpinned cards only (Sol-guided)", () => {
    const cards = listCards(seed(), { pinned: false });
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => !c.pinned)).toBe(true);
  });

  test("empty search term matches everything; whitespace is applied literally (Sol-guided)", () => {
    const all = listCards(seed());
    // An empty term is a no-op filter: everything matches.
    expect(listCards(seed(), { search: "" })).toHaveLength(all.length);
    // A whitespace term is a real term (length > 0): only cards whose
    // haystack literally contains the spaces match — the seeded cards do not.
    expect(listCards(seed(), { search: "   " })).toHaveLength(0);
    // Two-sided: a card whose text contains the spaces does match.
    let board = createBoard({ title: "T" }).toJSON();
    board = addCard(board, note({ text: "a   b" }));
    expect(listCards(board, { search: "   " })).toHaveLength(1);
  });

  test("sorts by created most recent first (Sol-guided)", () => {
    let board = createBoard({ title: "T" }).toJSON();
    board = addCard(board, {
      ...note({ title: "Old", text: "x" }),
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    board = addCard(board, {
      ...note({ title: "New", text: "y" }),
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-01T00:00:00.000Z",
    });
    expect(listCards(board, {}, "created").map((c) => c.title)).toEqual(["New", "Old"]);
  });
});

describe("searchBoard", () => {
  test("matches title and text, hiding archived", () => {
    expect(searchBoard(seed(), "dentist")).toHaveLength(1);
    expect(searchBoard(seed(), "archived")).toHaveLength(0);
  });
});

describe("boardStats", () => {
  test("aggregates counts and per-color breakdown", () => {
    const stats = boardStats(seed());
    expect(stats.total).toBe(4);
    expect(stats.notes).toBe(3);
    expect(stats.drawings).toBe(1);
    expect(stats.pinned).toBe(1);
    expect(stats.archived).toBe(1);
    expect(stats.colors.red).toBe(1);
    expect(stats.colors.default).toBe(3);
  });
});
