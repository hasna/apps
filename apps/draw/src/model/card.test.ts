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
});
