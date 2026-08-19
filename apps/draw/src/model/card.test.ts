import { describe, expect, test } from "bun:test";
import {
  CARD_COLORS,
  CardValidationError,
  cloneCard,
  drawing,
  isCardColor,
  note,
  validateCard,
} from "./card.js";
import { addStroke, createScene } from "./scene.js";

describe("note", () => {
  test("builds a note card with defaults", () => {
    const card = note();
    expect(card.kind).toBe("note");
    expect(card.color).toBe("default");
    expect(card.text).toBe("");
    expect(card.labels).toEqual([]);
    expect(card.pinned).toBe(false);
    expect(card.archived).toBe(false);
    expect(card.id).toBeString();
    expect(card.createdAt).toBeString();
  });

  test("carries input fields", () => {
    const card = note({ title: "Groceries", text: "milk\neggs", color: "green", labels: ["home"], pinned: true });
    expect(card.title).toBe("Groceries");
    expect(card.text).toBe("milk\neggs");
    expect(card.color).toBe("green");
    expect(card.labels).toEqual(["home"]);
    expect(card.pinned).toBe(true);
  });

  test("rejects an invalid color, falling back to default", () => {
    const card = note({ color: "chartreuse" as never });
    expect(card.color).toBe("default");
  });

  test("does not retain the caller's mutable labels array", () => {
    const labels = ["home"];
    const card = note({ labels });
    labels.push("work");
    expect(card.labels).toEqual(["home"]);
  });

  test("an explicit valid color is honored", () => {
    const card = note({ color: "teal" });
    expect(card.color).toBe("teal");
  });
});

describe("drawing", () => {
  test("builds a drawing card with an empty scene by default", () => {
    const card = drawing();
    expect(card.kind).toBe("drawing");
    expect(card.scene).toBeDefined();
    expect(card.scene!.elements).toHaveLength(0);
    expect(card.text).toBeUndefined();
  });

  test("deep copies the provided scene", () => {
    const scene = addStroke(createScene(), [[0, 0], [10, 10]]);
    const card = drawing({ scene });
    expect(card.scene!.elements).toHaveLength(1);
    // mutating the source scene must not leak into the card
    scene.elements.push({ id: "x", type: "line", x: 0, y: 0, width: 0, height: 0 });
    expect(card.scene!.elements).toHaveLength(1);
  });
});

describe("CARD_COLORS / isCardColor", () => {
  test("has ten colors including default", () => {
    expect(CARD_COLORS).toContain("default");
    expect(CARD_COLORS).toHaveLength(10);
  });

  test("isCardColor guards", () => {
    expect(isCardColor("blue")).toBe(true);
    expect(isCardColor("mauve")).toBe(false);
    expect(isCardColor(42)).toBe(false);
  });
});

describe("cloneCard", () => {
  test("produces an independent copy", () => {
    const card = note({ labels: ["a"] });
    const copy = cloneCard(card);
    copy.labels.push("b");
    expect(card.labels).toEqual(["a"]);
  });

  test("deep copies a drawing scene", () => {
    const card = drawing({ scene: addStroke(createScene(), [[0, 0], [1, 1]]) });
    const copy = cloneCard(card);
    copy.scene!.elements.pop();
    expect(card.scene!.elements).toHaveLength(1);
  });

  test("deep copies element point and pressure arrays", () => {
    const card = drawing({ scene: addStroke(createScene(), [[0, 0], [2, 3]], { pressures: [0.1, 0.9] }) });
    const copy = cloneCard(card);
    copy.scene!.elements[0]!.points![0] = [99, 99];
    copy.scene!.elements[0]!.pressures![0] = 0.99;
    expect(card.scene!.elements[0]!.points).toEqual([
      [0, 0],
      [2, 3],
    ]);
    expect(card.scene!.elements[0]!.pressures).toEqual([0.1, 0.9]);
  });
});

describe("validateCard", () => {
  test("coerces a minimal note", () => {
    const card = validateCard({ kind: "note" });
    expect(card.kind).toBe("note");
    expect(card.text).toBe("");
    expect(card.color).toBe("default");
    expect(card.id).toBeString();
  });

  test("throws on non-object", () => {
    expect(() => validateCard(null)).toThrow(CardValidationError);
  });

  test("throws on an invalid kind", () => {
    expect(() => validateCard({ kind: "sticker" })).toThrow(CardValidationError);
  });

  test("keeps a valid scene on a drawing card", () => {
    const card = validateCard({
      kind: "drawing",
      scene: {
        schema: "hasna.draw.scene",
        version: 1,
        elements: [{ type: "freedraw", x: 1, y: 2, width: 3, height: 4, points: [[0, 0], [3, 4]] }],
      },
    });
    expect(card.scene!.elements).toHaveLength(1);
    expect(card.scene!.elements[0]!.type).toBe("freedraw");
  });

  test("drops invalid labels", () => {
    const card = validateCard({ kind: "note", labels: ["ok", 3, null] });
    expect(card.labels).toEqual(["ok"]);
  });

  test("a drawing card with no scene gets a default empty scene", () => {
    const card = validateCard({ kind: "drawing" });
    expect(card.scene).toBeDefined();
    expect(card.scene!.elements).toHaveLength(0);
    expect(card.scene!.schema).toBe("hasna.draw.scene");
  });

  test("skips junk elements inside a scene", () => {
    const card = validateCard({
      kind: "drawing",
      scene: {
        elements: [
          null,
          "not-an-element",
          { x: 0, y: 0 }, // no type
          { type: "rectangle", x: 0, y: 0, width: 4, height: 4 },
        ],
      },
    });
    expect(card.scene!.elements).toHaveLength(1);
    expect(card.scene!.elements[0]!.type).toBe("rectangle");
  });

  test("coerces malformed element points to numbers and drops extra dimensions", () => {
    const card = validateCard({
      kind: "drawing",
      scene: {
        elements: [
          {
            type: "freedraw",
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            points: [
              [1, 2, 3],
              ["a", null],
              [5, 6],
            ],
          },
        ],
      },
    });
    const points = card.scene!.elements[0]!.points!;
    expect(points).toEqual([
      [1, 2],
      [0, 0],
      [5, 6],
    ]);
  });

  test("filters non-numeric pressures and keeps the rest", () => {
    const card = validateCard({
      kind: "drawing",
      scene: {
        elements: [
          { type: "freedraw", x: 0, y: 0, width: 0, height: 0, pressures: [0.5, "1", null, 0.9] },
        ],
      },
    });
    expect(card.scene!.elements[0]!.pressures).toEqual([0.5, 0.9]);
  });

  test("falls back to the card index when order is not a finite number", () => {
    const card = validateCard({ kind: "note", order: Number.NaN }, 3);
    expect(card.order).toBe(3);
  });

  test("keeps a finite negative order as-is", () => {
    const card = validateCard({ kind: "note", order: -5 });
    expect(card.order).toBe(-5);
  });

  test("replaces an empty id with a generated one", () => {
    const card = validateCard({ kind: "note", id: "" });
    expect(card.id).toBeString();
    expect(card.id.length).toBeGreaterThan(0);
  });

  test("a non boolean pinned value is treated as unpinned", () => {
    const card = validateCard({ kind: "note", pinned: "true" as never });
    expect(card.pinned).toBe(false);
  });

  test("drops a non string title", () => {
    const card = validateCard({ kind: "note", title: 42 as never });
    expect(card.title).toBeUndefined();
  });
});
