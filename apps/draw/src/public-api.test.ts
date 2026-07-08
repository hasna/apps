/**
 * Integration tests that drive @hasna/draw through its public entry point
 * (the barrel export in ./index.ts). These are complementary to the per module
 * unit tests: they verify the public surface is wired end to end and cover the
 * headline flows: board op lifecycle (create / update / reorder / pin / archive
 * / delete), note and drawing JSON round trips, Excalidraw interchange, and the
 * query API.
 */
import { describe, expect, test } from "bun:test";
import {
  addCard,
  addElement,
  addStroke,
  archiveCard,
  boardStats,
  BoardModel,
  CARD_COLORS,
  createBoard,
  createScene,
  deleteCard,
  drawing,
  fromExcalidraw,
  listCards,
  loadBoard,
  note,
  parseBoard,
  pinCard,
  removeElement,
  reorderCard,
  sceneBounds,
  searchBoard,
  serializeBoard,
  setCardColor,
  toBoardDocument,
  toExcalidraw,
  updateCard,
  validateBoard,
  VERSION,
} from "./index.js";
import type { Board, Card } from "./index.js";

const PAST = "2020-01-01T00:00:00.000Z";

function boardWith(cards: Card[]): Board {
  return { id: "b1", title: "fixture", cards, createdAt: PAST, updatedAt: PAST };
}

function noteCard(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    kind: "note",
    text: "",
    color: "default",
    labels: [],
    pinned: false,
    archived: false,
    order: 0,
    createdAt: PAST,
    updatedAt: PAST,
    ...over,
  };
}

function drawingCard(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    kind: "drawing",
    scene: createScene(),
    color: "default",
    labels: [],
    pinned: false,
    archived: false,
    order: 0,
    createdAt: PAST,
    updatedAt: PAST,
    ...over,
  };
}

describe("public API surface", () => {
  test("the barrel exports the documented functions and constants", () => {
    expect(typeof createBoard).toBe("function");
    expect(typeof loadBoard).toBe("function");
    expect(BoardModel).toBeDefined();
    expect(typeof note).toBe("function");
    expect(typeof drawing).toBe("function");
    expect(typeof addCard).toBe("function");
    expect(typeof listCards).toBe("function");
    expect(typeof serializeBoard).toBe("function");
    expect(typeof parseBoard).toBe("function");
    expect(typeof toExcalidraw).toBe("function");
    expect(typeof fromExcalidraw).toBe("function");
    expect(Array.isArray(CARD_COLORS)).toBe(true);
    expect(CARD_COLORS).toContain("default");
    expect(VERSION).toBe("0.1.0");
  });
});

describe("board op lifecycle (functional core)", () => {
  test("addCard appends, densifies order, bumps board updatedAt, and is immutable", () => {
    const b0 = boardWith([]);
    const b1 = addCard(b0, noteCard("a", { order: 99 }));
    expect(b1.cards.length).toBe(1);
    expect(b1.cards[0]?.order).toBe(0);
    expect(b1.updatedAt > PAST).toBe(true);
    expect(b0.cards.length).toBe(0); // input untouched

    const b2 = addCard(b1, noteCard("b"));
    expect(b2.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect(b2.cards.map((c) => c.order)).toEqual([0, 1]);
  });

  test("updateCard patches fields, bumps the card updatedAt, and no ops unknown ids", () => {
    const base = addCard(addCard(boardWith([]), noteCard("a")), noteCard("b"));
    const upd = updateCard(base, "a", { text: "hello", color: "red", labels: ["x"] });
    const a = upd.cards.find((c) => c.id === "a");
    expect(a?.text).toBe("hello");
    expect(a?.color).toBe("red");
    expect(a?.labels).toEqual(["x"]);
    expect((a?.updatedAt ?? PAST) > PAST).toBe(true);
    // untouched card keeps its timestamp
    expect(upd.cards.find((c) => c.id === "b")?.updatedAt).toBe(PAST);
    // unknown id returns the same board reference
    expect(updateCard(base, "zzz", { text: "x" })).toBe(base);
  });

  test("pin and archive set explicitly or toggle", () => {
    const base = addCard(boardWith([]), noteCard("a"));
    const pinnedOn = pinCard(base, "a");
    expect(pinnedOn.cards[0]?.pinned).toBe(true);
    expect(pinCard(pinnedOn, "a", false).cards[0]?.pinned).toBe(false);

    const archivedOn = archiveCard(base, "a", true);
    expect(archivedOn.cards[0]?.archived).toBe(true);
    expect(archiveCard(archivedOn, "a").cards[0]?.archived).toBe(false);

    expect(pinCard(base, "zzz")).toBe(base);
  });

  test("setCardColor updates the color", () => {
    const base = addCard(boardWith([]), noteCard("a"));
    expect(setCardColor(base, "a", "blue").cards[0]?.color).toBe("blue");
  });

  test("deleteCard removes and re densifies order", () => {
    const three = ["a", "b", "c"].reduce((bd, id) => addCard(bd, noteCard(id)), boardWith([]));
    expect(three.cards.map((c) => c.order)).toEqual([0, 1, 2]);
    const del = deleteCard(three, "b");
    expect(del.cards.map((c) => c.id)).toEqual(["a", "c"]);
    expect(del.cards.map((c) => c.order)).toEqual([0, 1]);
    expect(deleteCard(three, "zzz")).toBe(three);
  });

  test("reorderCard moves a card, clamps the index, and no ops when unchanged", () => {
    const three = ["a", "b", "c"].reduce((bd, id) => addCard(bd, noteCard(id)), boardWith([]));
    const moved = reorderCard(three, "a", 2);
    expect(moved.cards.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(moved.cards.map((c) => c.order)).toEqual([0, 1, 2]);
    // out of range index clamps to the end
    expect(reorderCard(three, "a", 99).cards.map((c) => c.id)).toEqual(["b", "c", "a"]);
    // same index or unknown id is a no op (same reference)
    expect(reorderCard(three, "a", 0)).toBe(three);
    expect(reorderCard(three, "zzz", 1)).toBe(three);
  });
});

describe("BoardModel wrapper", () => {
  test("create, chainable add, reads, stats, and clone independence", () => {
    const model = createBoard({ title: "Keep" })
      .addNote({ title: "T", text: "body", color: "green", labels: ["a"] })
      .addDrawing({ title: "D" });

    expect(model).toBeInstanceOf(BoardModel);
    expect(model.title).toBe("Keep");

    const cards = model.cards;
    expect(cards.length).toBe(2);
    expect(cards[0]?.kind).toBe("note");
    expect(cards[1]?.kind).toBe("drawing");
    expect(cards[1]?.scene?.schema).toBe("hasna.draw.scene");

    const stats = model.stats();
    expect(stats).toMatchObject({ total: 2, notes: 1, drawings: 1 });
    expect(stats.colors.green).toBe(1);

    const firstId = cards[0]?.id as string;
    expect(model.card(firstId)?.title).toBe("T");
    expect(model.card("nope")).toBeUndefined();

    const clone = model.clone().addNote({ text: "x" });
    expect(model.cards.length).toBe(2); // original unchanged
    expect(clone.cards.length).toBe(3);
  });

  test("serialize then loadBoard round trips through the model", () => {
    const model = createBoard({ title: "Keep" }).addNote({ text: "hi" });
    const loaded = loadBoard(model.serialize());
    expect(loaded.title).toBe("Keep");
    expect(loaded.cards.length).toBe(1);
    expect(loaded.cards[0]?.text).toBe("hi");
  });
});

describe("JSON serialization round trip", () => {
  test("a note survives serialize then parse with all fields intact", () => {
    const rb = addCard(
      boardWith([]),
      noteCard("note", {
        title: "N",
        text: "hello\nworld",
        color: "orange",
        labels: ["a", "b"],
        pinned: true,
      }),
    );
    const round = parseBoard(serializeBoard(rb));
    expect(round.cards.find((c) => c.id === "note")).toMatchObject({
      kind: "note",
      title: "N",
      text: "hello\nworld",
      color: "orange",
      labels: ["a", "b"],
      pinned: true,
    });
  });

  test("a drawing survives serialize then parse with scene geometry intact", () => {
    const scene = addStroke(createScene(), [
      [0, 0],
      [3, 4],
    ], { strokeColor: "#123456", strokeWidth: 2 });
    const rb = addCard(boardWith([]), drawingCard("draw", { title: "D", scene }));
    const round = parseBoard(serializeBoard(rb));

    const rd = round.cards.find((c) => c.id === "draw");
    expect(rd?.kind).toBe("drawing");
    expect(rd?.scene?.elements.length).toBe(1);
    const el = rd?.scene?.elements[0];
    expect(el?.type).toBe("freedraw");
    expect(el?.points).toEqual([
      [0, 0],
      [3, 4],
    ]);
    expect(el?.strokeColor).toBe("#123456");
    expect(el?.strokeWidth).toBe(2);
  });

  test("toBoardDocument wraps in the versioned envelope; validateBoard coerces a bare object", () => {
    const doc = toBoardDocument(boardWith([]));
    expect(doc.schema).toBe("hasna.draw.board");
    expect(doc.version).toBe(1);

    const coerced = validateBoard({ cards: [] });
    expect(coerced.cards).toEqual([]);
    expect(typeof coerced.id).toBe("string");
  });

  test("parseBoard rejects malformed input", () => {
    expect(() => parseBoard("not json")).toThrow();
    expect(() => parseBoard(42 as unknown)).toThrow();
  });
});

describe("Excalidraw interchange", () => {
  test("scene round trips through toExcalidraw and fromExcalidraw preserving styling", () => {
    const stroke = addStroke(createScene({ background: "#ffffff" }), [
      [1, 1],
      [5, 9],
    ], { strokeColor: "#aabbcc", strokeWidth: 3, opacity: 70, pressures: [0.1, 0.2] });
    const scene = addElement(stroke, {
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      backgroundColor: "#eeeeee",
      fillStyle: "solid",
      angle: 0.5,
    });

    const ex = toExcalidraw(scene);
    expect(ex.type).toBe("excalidraw");
    expect(ex.version).toBe(2);
    expect(ex.source).toBe("@hasna/draw");
    expect(ex.appState.viewBackgroundColor).toBe("#ffffff");
    expect(ex.elements.length).toBe(2);

    const back = fromExcalidraw(ex);
    expect(back.elements.length).toBe(2);
    expect(back.background).toBe("#ffffff");

    const fd = back.elements.find((e) => e.type === "freedraw");
    expect(fd?.strokeColor).toBe("#aabbcc");
    expect(fd?.strokeWidth).toBe(3);
    expect(fd?.opacity).toBe(70);
    expect(fd?.pressures).toEqual([0.1, 0.2]);

    const rect = back.elements.find((e) => e.type === "rectangle");
    expect(rect?.backgroundColor).toBe("#eeeeee");
    expect(rect?.fillStyle).toBe("solid");
    expect(rect?.angle).toBe(0.5);
  });

  test("fromExcalidraw drops unknown element types", () => {
    const scene = fromExcalidraw({
      elements: [
        { type: "image", x: 0, y: 0, width: 1, height: 1 },
        { type: "rectangle", x: 1, y: 2, width: 3, height: 4 },
      ],
    });
    expect(scene.elements.map((e) => e.type)).toEqual(["rectangle"]);
  });
});

describe("query API", () => {
  function mixedBoard(): Board {
    let b = boardWith([]);
    b = addCard(b, noteCard("n1", { text: "alpha", color: "red", labels: ["work"] }));
    b = addCard(b, noteCard("n2", { text: "beta", pinned: true }));
    b = addCard(b, drawingCard("d1", { color: "blue" }));
    b = addCard(b, noteCard("n3", { text: "gamma", archived: true }));
    return b;
  }

  test("listCards hides archived by default and floats pinned to the top", () => {
    const visible = listCards(mixedBoard());
    expect(visible.map((c) => c.id)).toEqual(["n2", "n1", "d1"]);
  });

  test("listCards filters by kind, color, label, pinned, and archived", () => {
    const b = mixedBoard();
    expect(listCards(b, { kind: "drawing" }).map((c) => c.id)).toEqual(["d1"]);
    expect(listCards(b, { color: "red" }).map((c) => c.id)).toEqual(["n1"]);
    expect(listCards(b, { label: "work" }).map((c) => c.id)).toEqual(["n1"]);
    expect(listCards(b, { pinned: true }).map((c) => c.id)).toEqual(["n2"]);
    expect(listCards(b, { archived: true }).map((c) => c.id)).toEqual(["n3"]);
  });

  test("listCards search matches title and text of visible cards", () => {
    expect(listCards(mixedBoard(), { search: "alpha" }).map((c) => c.id)).toEqual(["n1"]);
  });

  test("listCards sorts by updated time most recent first", () => {
    let sb = boardWith([]);
    sb = addCard(sb, noteCard("old", { updatedAt: "2021-01-01T00:00:00.000Z" }));
    sb = addCard(sb, noteCard("new", { updatedAt: "2023-01-01T00:00:00.000Z" }));
    expect(listCards(sb, {}, "updated").map((c) => c.id)).toEqual(["new", "old"]);
  });

  test("searchBoard excludes archived cards", () => {
    const b = mixedBoard();
    expect(searchBoard(b, "beta").map((c) => c.id)).toEqual(["n2"]);
    expect(searchBoard(b, "gamma")).toEqual([]);
  });

  test("boardStats aggregates counts and a per color breakdown", () => {
    const stats = boardStats(mixedBoard());
    expect(stats).toMatchObject({ total: 4, notes: 3, drawings: 1, pinned: 1, archived: 1 });
    expect(stats.colors.red).toBe(1);
    expect(stats.colors.blue).toBe(1);
    expect(stats.colors.default).toBe(2);
  });
});

describe("scene helpers", () => {
  test("createScene is empty; addStroke and addElement append immutably", () => {
    const empty = createScene();
    expect(empty.elements).toEqual([]);
    expect(empty.schema).toBe("hasna.draw.scene");
    expect(sceneBounds(empty)).toEqual({ x: 0, y: 0, width: 0, height: 0 });

    const s1 = addStroke(empty, [
      [10, 10],
      [20, 30],
    ]);
    expect(empty.elements.length).toBe(0); // input untouched
    expect(s1.elements.length).toBe(1);
    expect(sceneBounds(s1)).toEqual({ x: 10, y: 10, width: 10, height: 20 });

    const s2 = addElement(s1, { type: "rectangle", x: 0, y: 0, width: 5, height: 5 });
    expect(s2.elements.length).toBe(2);
    const id = s2.elements[1]?.id as string;
    expect(removeElement(s2, id).elements.length).toBe(1);
  });
});
