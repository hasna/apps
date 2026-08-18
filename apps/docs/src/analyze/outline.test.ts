import { describe, expect, test } from "bun:test";
import { countWords, getOutline, nodeText, slugify, toText } from "./outline.js";
import { bold, hardBreak, heading, horizontalRule, paragraph, text } from "../model/schema.js";
import type { DocJSON } from "../types/index.js";

const doc: DocJSON = {
  type: "doc",
  content: [
    heading(1, [text("Getting Started")]),
    paragraph([text("Hello world, this is a test.")]),
    heading(2, [text("Getting Started")]),
    paragraph([text("More "), text("bold", [bold()]), text(" text here.")]),
  ],
};

describe("nodeText / toText", () => {
  test("nodeText concatenates inline text", () => {
    expect(nodeText(doc.content![1]!)).toBe("Hello world, this is a test.");
  });

  test("toText joins blocks", () => {
    expect(toText(doc)).toContain("Getting Started");
    expect(toText(doc)).toContain("More bold text here.");
  });

  test("keeps hard breaks while omitting horizontal rules", () => {
    const withBreak: DocJSON = {
      type: "doc",
      content: [paragraph([text("first"), hardBreak(), text("second")]), horizontalRule(), paragraph([text("third")])],
    };
    expect(toText(withBreak)).toBe("first\nsecond\n\nthird");
  });
});

describe("slugify", () => {
  test("makes URL-safe slugs", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("  Multiple   Spaces ")).toBe("multiple-spaces");
  });

  test("supports Unicode headings and empty slug input", () => {
    expect(slugify("  Învățare — étape 2  ")).toBe("învățare-étape-2");
    expect(slugify("!!!")).toBe("");
  });
});

describe("getOutline", () => {
  test("returns headings with levels and indices", () => {
    const outline = getOutline(doc);
    expect(outline.length).toBe(2);
    expect(outline[0]).toMatchObject({ level: 1, text: "Getting Started", index: 0 });
    expect(outline[1]).toMatchObject({ level: 2, index: 2 });
  });

  test("de-duplicates slug ids", () => {
    const outline = getOutline(doc);
    expect(outline[0]?.id).toBe("getting-started");
    expect(outline[1]?.id).toBe("getting-started-1");
  });
});

describe("countWords", () => {
  test("counts words, characters, headings, paragraphs", () => {
    const stats = countWords(doc);
    expect(stats.words).toBeGreaterThan(0);
    expect(stats.headings).toBe(2);
    expect(stats.paragraphs).toBe(2);
    expect(stats.characters).toBeGreaterThan(stats.charactersNoSpaces);
    expect(stats.readingTimeMinutes).toBeGreaterThanOrEqual(1);
  });

  test("empty document has zero words and zero reading time", () => {
    const empty: DocJSON = { type: "doc", content: [paragraph()] };
    const stats = countWords(empty);
    expect(stats.words).toBe(0);
    expect(stats.readingTimeMinutes).toBe(0);
  });

  test("counts Unicode characters without counting whitespace", () => {
    const unicode: DocJSON = { type: "doc", content: [paragraph([text("café 你好")])] };
    expect(countWords(unicode)).toMatchObject({ words: 2, characters: 7, charactersNoSpaces: 6 });
  });

  test("counts sentence punctuation and applies the 200-word reading boundary", () => {
    const exactBoundary: DocJSON = {
      type: "doc",
      content: [paragraph([text(Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "))])],
    };
    const overBoundary: DocJSON = {
      type: "doc",
      content: [paragraph([text(`${Array.from({ length: 200 }, () => "word").join(" ")} extra`)])],
    };
    const sentences = countWords({
      type: "doc",
      content: [paragraph([text("One. Two! Three?")])],
    });

    expect(sentences.sentences).toBe(3);
    expect(countWords(exactBoundary).readingTimeMinutes).toBe(1);
    expect(countWords(overBoundary).readingTimeMinutes).toBe(2);
  });

  test("handles documents without a content array", () => {
    expect(toText({ type: "doc" })).toBe("");
    expect(countWords({ type: "doc" })).toMatchObject({
      words: 0,
      characters: 0,
      charactersNoSpaces: 0,
      paragraphs: 0,
      headings: 0,
      sentences: 0,
      readingTimeMinutes: 0,
    });
    expect(getOutline({ type: "doc" })).toEqual([]);
  });
});
