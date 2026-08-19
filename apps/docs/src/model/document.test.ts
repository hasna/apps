import { describe, expect, test } from "bun:test";
import { createDocument, Document, loadDocument } from "./document.js";
import { bold, heading, paragraph, text } from "./schema.js";

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

  test("fromJSON clones input so later mutations of the source are invisible", () => {
    const json = { type: "doc", content: [paragraph([text("x")])] };
    const doc = Document.fromJSON(json);
    json.content![0]!.content![0]!.text = "mutated";
    expect(doc.toText()).toBe("x");
  });

  test("fromMarkdown and fromHTML factories parse their formats", () => {
    expect(Document.fromMarkdown("# T").outline()[0]?.text).toBe("T");
    expect(Document.fromHTML("<h2>H</h2>").outline()[0]?.level).toBe(2);
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

  test("outline and stats on an empty document", () => {
    const doc = createDocument();
    expect(doc.outline()).toEqual([]);
    expect(doc.stats().words).toBe(0);
    expect(doc.wordCount()).toBe(0);
  });
});

describe("copy semantics", () => {
  test("toJSON returns a deep copy", () => {
    const doc = createDocument({ content: [paragraph([text("x")])] });
    const json = doc.toJSON();
    json.content![0]!.content![0]!.text = "mutated";
    expect(doc.toText()).toBe("x");
  });

  test("blocks getter returns deep copies", () => {
    const doc = createDocument({ content: [paragraph([text("x")])] });
    const blocks = doc.blocks;
    blocks[0]!.content![0]!.text = "mutated";
    expect(doc.toText()).toBe("x");
  });

  test("append clones the node it is given", () => {
    const doc = createDocument();
    const node = paragraph([text("app")]);
    doc.append(node);
    node.content![0]!.text = "mutated";
    // createDocument() starts with one empty paragraph, so the appended node
    // lands at index 1.
    expect(doc.blocks[1]!.content?.[0]?.text).toBe("app");
  });

  test("create clones its initial content", () => {
    const content = [paragraph([text("orig")])];
    const doc = createDocument({ content });
    content[0]!.content![0]!.text = "mutated";
    expect(doc.toText()).toBe("orig");
  });
});

describe("applyAll", () => {
  test("applies all steps, reports the count, and mutates the instance", () => {
    const doc = createDocument({ content: [paragraph([text("a")]), paragraph([text("b")])] });
    const result = doc.applyAll([
      { type: "removeNode", index: 0 },
      { type: "insertText", index: 0, text: "new" },
    ]);
    expect(result.applied).toBe(2);
    expect(doc.blocks[0]!.content?.[0]?.text).toBe("new");
    expect(result.doc.content?.[0]?.content?.[0]?.text).toBe("new");
  });

  test("insertText carries marks through to the inserted paragraph", () => {
    const doc = createDocument().insertText(0, "hi", [bold()]);
    expect(doc.blocks[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "hi", marks: [{ type: "bold" }] }],
    });
  });

  test("setContent replaces the whole body", () => {
    const doc = createDocument({ content: [paragraph([text("old")])] }).setContent([
      heading(1, [text("new")]),
    ]);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]?.type).toBe("heading");
  });
});
