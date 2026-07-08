import { describe, expect, test } from "bun:test";
import { createDocument, Document, loadDocument } from "./document.js";
import { heading, paragraph, text } from "./schema.js";

describe("createDocument / loadDocument", () => {
  test("create makes an empty document", () => {
    const doc = createDocument();
    expect(doc.toJSON()).toEqual({ type: "doc", content: [{ type: "paragraph", content: [] }] });
  });

  test("create accepts initial content", () => {
    const doc = createDocument({ content: [heading(1, [text("Hi")])] });
    expect(doc.outline().length).toBe(1);
  });

  test("loadDocument validates and clones input", () => {
    const json = { type: "doc", content: [paragraph([text("x")])] };
    const doc = loadDocument(json);
    doc.append(paragraph([text("y")]));
    // original json is untouched
    expect(json.content.length).toBe(1);
    expect(doc.blocks.length).toBe(2);
  });

  test("loadDocument rejects invalid input", () => {
    expect(() => loadDocument({ type: "nope" })).toThrow();
  });
});

describe("serialization surface", () => {
  test("markdown import -> json -> markdown", () => {
    const doc = Document.fromMarkdown("# Title\n\nSome **bold** text.");
    expect(doc.toMarkdown()).toContain("# Title");
    expect(doc.toMarkdown()).toContain("**bold**");
    expect(doc.toHTML()).toContain("<h1>Title</h1>");
    expect(doc.toText()).toContain("Some bold text.");
  });

  test("html import round-trips through the model", () => {
    const doc = Document.fromHTML("<h2>Sub</h2><p>Body</p>");
    expect(doc.outline()[0]).toMatchObject({ level: 2, text: "Sub" });
    expect(doc.toMarkdown()).toContain("## Sub");
  });
});

describe("chainable editing", () => {
  test("append/prepend/insertText mutate and chain", () => {
    const doc = createDocument()
      .setContent([paragraph([text("middle")])])
      .prepend(heading(1, [text("top")]))
      .append(paragraph([text("bottom")]))
      .insertText(1, "inserted");
    const texts = doc.blocks.map((b) => b.content?.[0]?.text);
    expect(texts).toEqual(["top", "inserted", "middle", "bottom"]);
  });

  test("clone is independent", () => {
    const a = createDocument({ content: [paragraph([text("a")])] });
    const b = a.clone().append(paragraph([text("b")]));
    expect(a.blocks.length).toBe(1);
    expect(b.blocks.length).toBe(2);
  });
});

describe("analysis surface", () => {
  test("stats and wordCount", () => {
    const doc = Document.fromMarkdown("# Heading\n\none two three four five");
    // 1 heading word + 5 paragraph words
    expect(doc.wordCount()).toBe(6);
    expect(doc.stats().headings).toBe(1);
  });
});
