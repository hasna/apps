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

  test("collapses runs of hyphens and trims leading/trailing hyphens", () => {
    expect(slugify("a -- b")).toBe("a-b");
    expect(slugify("-leading-")).toBe("leading");
    expect(slugify("trailing-")).toBe("trailing");
  });

  test("keeps digits and CJK, drops punctuation and emoji", () => {
    expect(slugify("Version 2.0!")).toBe("version-20");
    expect(slugify("中文标题")).toBe("中文标题");
    expect(slugify("emoji 🎉 here")).toBe("emoji-here");
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

  test("empty heading text falls back to a heading-N id and dedupes", () => {
    const outline = getOutline({
      type: "doc",
      content: [heading(1, []), heading(2, [text("   ")]), heading(3, [text("x")])],
    });
    expect(outline.map((e) => e.id)).toEqual(["heading-0", "heading-1", "x"]);
  });

  test("reports the top-level block index even when non-heading blocks sit between", () => {
    const outline = getOutline({
      type: "doc",
      content: [paragraph([text("p")]), heading(2, [text("A")]), horizontalRule(), heading(3, [text("B")])],
    });
    expect(outline.map((e) => e.index)).toEqual([1, 3]);
  });

  test("a heading without attrs defaults to level 1", () => {
    const outline = getOutline({ type: "doc", content: [{ type: "heading", content: [text("x")] }] });
    expect(outline[0]?.level).toBe(1);
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

  test("nodeText joins nested inline content and maps hard breaks", () => {
    const node = paragraph([text("a"), hardBreak(), text("b")]);
    expect(nodeText(node)).toBe("a\nb");
  });

  test("toText collapses runs of three or more newlines to one blank line", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [
        paragraph([text("a"), hardBreak(), hardBreak(), hardBreak(), text("b")]),
        paragraph([text("c")]),
      ],
    };
    expect(toText(doc)).toBe("a\n\nb\nc");
  });

  test("toText omits horizontal rules, leaving a blank line between neighbors", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [paragraph([text("a")]), horizontalRule(), paragraph([text("end")])],
    };
    expect(toText(doc)).toBe("a\n\nend");
  });

  test("words are counted across separate text nodes inside one paragraph", () => {
    const doc: DocJSON = { type: "doc", content: [paragraph([text("one "), text("two three")])] };
    expect(countWords(doc).words).toBe(3);
  });

  test("astral-pair characters count as single characters", () => {
    const doc: DocJSON = { type: "doc", content: [paragraph([text("a😀b")])] };
    expect(countWords(doc).characters).toBe(3);
    expect(countWords(doc).charactersNoSpaces).toBe(3);
  });

  test("list and code-block content is walked for words but not counted as paragraphs", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [paragraph([text("list words")])] }],
        },
        { type: "codeBlock", attrs: { language: null }, content: [text("code words")] },
      ],
    };
    const stats = countWords(doc);
    expect(stats.words).toBe(4);
    expect(stats.paragraphs).toBe(0);
  });

  test("sentences split on . ! ? followed by whitespace or end", () => {
    const doc: DocJSON = { type: "doc", content: [paragraph([text("One. Two! Three?")])] };
    expect(countWords(doc).sentences).toBe(3);
    const noTrail: DocJSON = { type: "doc", content: [paragraph([text("No punctuation")])] };
    expect(countWords(noTrail).sentences).toBe(1);
  });
});
