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

  test("an empty search term does not filter, whitespace matches literally", () => {
    expect(listCards(seed(), { search: "" })).toHaveLength(3);
    // A non-empty term filters even when it is only whitespace (literal match).
    expect(listCards(seed(), { search: "  " })).toHaveLength(0);
  });

  test("an archived pinned card is hidden by the default query", () => {
    const board = seed();
    board.cards[0]!.pinned = true;
    board.cards[0]!.archived = true;
    const cards = listCards(board);
    expect(cards.some((c) => c.id === board.cards[0]!.id)).toBe(false);
  });

  test("sorts by created time, most recent first", () => {
    let board = createBoard().toJSON();
    board = addCard(board, note({ title: "Old" }));
    board = addCard(board, note({ title: "New" }));
    // Force deterministic, distinct creation times.
    board.cards[0]!.createdAt = "2026-01-01T00:00:00.000Z";
    board.cards[1]!.createdAt = "2026-02-01T00:00:00.000Z";
    const cards = listCards(board, {}, "created");
    expect(cards.map((c) => c.title)).toEqual(["New", "Old"]);
  });

  test("sorts by updated time, most recent first", () => {
    let board = createBoard().toJSON();
    board = addCard(board, note({ title: "Stale" }));
    board = addCard(board, note({ title: "Fresh" }));
    board.cards[0]!.updatedAt = "2026-01-01T00:00:00.000Z";
    board.cards[1]!.updatedAt = "2026-03-01T00:00:00.000Z";
    const cards = listCards(board, {}, "updated");
    expect(cards.map((c) => c.title)).toEqual(["Fresh", "Stale"]);
  });

  test("an unknown sort value falls back to order (pinned first)", () => {
    const board = seed();
    const cards = listCards(board, {}, "bogus" as never);
    expect(cards.map((c) => c.order)).toEqual([2, 0, 1]);
  });

  test("pinned cards stay on top regardless of sort", () => {
    let board = createBoard().toJSON();
    board = addCard(board, note({ title: "Unpinned-old" }));
    board = addCard(board, note({ title: "Pinned-new", pinned: true }));
    board.cards[0]!.createdAt = "2026-05-01T00:00:00.000Z";
    board.cards[1]!.createdAt = "2026-01-01T00:00:00.000Z";
    const cards = listCards(board, {}, "created");
    expect(cards.map((c) => c.title)).toEqual(["Pinned-new", "Unpinned-old"]);
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
