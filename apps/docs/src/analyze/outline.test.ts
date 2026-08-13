import { describe, expect, test } from "bun:test";
import { countWords, getOutline, nodeText, slugify, toText } from "./outline.js";
import { bold, heading, paragraph, text } from "../model/schema.js";
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
});

describe("slugify", () => {
  test("makes URL-safe slugs", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("  Multiple   Spaces ")).toBe("multiple-spaces");
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
});
