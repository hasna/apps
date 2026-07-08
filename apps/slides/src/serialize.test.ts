import { describe, expect, test } from "bun:test";
import { createDeck } from "./deck.js";
import { serializeDeck, deserializeDeck, cloneDeckData } from "./serialize.js";

describe("serialize", () => {
  test("serialize -> deserialize round-trips", () => {
    const deck = createDeck({
      title: "Roundtrip",
      slides: [
        { body: "# One", notes: "n1", fragments: ["a", "b"] },
        { body: "Two", children: [{ body: "Two.1" }] },
      ],
    });
    const json = serializeDeck(deck.toJSON());
    const back = deserializeDeck(json);
    expect(back).toEqual(deck.toJSON());
  });

  test("deserialize accepts a plain object", () => {
    const deck = createDeck({ slides: [{ body: "x" }] });
    const back = deserializeDeck(deck.toJSON());
    expect(back.slides).toHaveLength(1);
  });

  test("deserialize throws on invalid data", () => {
    expect(() => deserializeDeck("{}")).toThrow();
    expect(() => deserializeDeck({ id: "x" })).toThrow();
  });

  test("cloneDeckData is a deep copy", () => {
    const data = createDeck({ slides: [{ body: "a" }] }).toJSON();
    const copy = cloneDeckData(data);
    copy.slides[0]!.body = "changed";
    expect(data.slides[0]!.body).toBe("a");
  });
});
