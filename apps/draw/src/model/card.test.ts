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

  test("defaults order from the supplied index (Sol-guided)", () => {
    expect(validateCard({ kind: "note" }, 0).order).toBe(0);
    expect(validateCard({ kind: "note" }, 3).order).toBe(3);
    // an explicit finite order wins over the index
    expect(validateCard({ kind: "note", order: 7 }, 3).order).toBe(7);
  });

  test("archived is strict true (Sol-guided)", () => {
    expect(validateCard({ kind: "note", archived: true }).archived).toBe(true);
    expect(validateCard({ kind: "note", archived: "yes" }).archived).toBe(false);
    expect(validateCard({ kind: "note", archived: 1 }).archived).toBe(false);
    expect(validateCard({ kind: "note" }).archived).toBe(false);
  });

  test("invalid or absent drawing scene becomes an empty scene (Sol-guided)", () => {
    expect(validateCard({ kind: "drawing" }).scene!.elements).toHaveLength(0);
    expect(validateCard({ kind: "drawing", scene: null }).scene!.elements).toHaveLength(0);
    expect(validateCard({ kind: "drawing", scene: 42 }).scene!.elements).toHaveLength(0);
    expect(validateCard({ kind: "drawing", scene: { elements: "nope" } }).scene!.elements).toHaveLength(0);
  });

  test("malformed element points are filtered and coerced as documented (Sol-guided)", () => {
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
              [0, 0],
              [1], // too short: dropped
              null, // not an array: dropped
              ["3", "4"], // numeric strings: coerced to numbers
              [5, "6"],
            ],
          },
        ],
      },
    });
    expect(card.scene!.elements[0]!.points).toEqual([
      [0, 0],
      [3, 4],
      [5, 6],
    ]);
  });

  test("non-string titles are dropped (Sol-guided)", () => {
    expect(validateCard({ kind: "note", title: 42 }).title).toBeUndefined();
    expect(validateCard({ kind: "note", title: null }).title).toBeUndefined();
  });

  test("validateCard preserves angle, strokeColor, fillStyle, and seed (Sol-guided)", () => {
    const card = validateCard({
      kind: "drawing",
      scene: {
        elements: [
          {
            type: "rectangle",
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            angle: 0.5,
            strokeColor: "#ff0000",
            fillStyle: "hachure",
            seed: 12345,
          },
        ],
      },
    });
    const el = card.scene!.elements[0]!;
    expect(el.angle).toBe(0.5);
    expect(el.strokeColor).toBe("#ff0000");
    expect(el.fillStyle).toBe("hachure");
    expect(el.seed).toBe(12345);
  });
});
