import { describe, expect, test } from "bun:test";
import { fromMarkdown, toMarkdown } from "./markdown.js";
import type { DocJSON } from "../types/index.js";

function roundtrip(md: string): string {
  return toMarkdown(fromMarkdown(md)).trim();
}

describe("fromMarkdown", () => {
  test("headings", () => {
    const doc = fromMarkdown("# Title\n\n## Sub");
    expect(doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(doc.content?.[1]).toMatchObject({ type: "heading", attrs: { level: 2 } });
  });

  test("inline marks", () => {
    const doc = fromMarkdown("This is **bold**, *italic*, ~~gone~~ and `code`.");
    const para = doc.content?.[0];
    const marks = (para?.content ?? []).flatMap((n) => n.marks?.map((m) => m.type) ?? []);
    expect(marks).toContain("bold");
    expect(marks).toContain("italic");
    expect(marks).toContain("strike");
    expect(marks).toContain("code");
  });

  test("links", () => {
    const doc = fromMarkdown("See [the site](https://hasna.dev).");
    const link = (doc.content?.[0]?.content ?? []).find((n) =>
      n.marks?.some((m) => m.type === "link"),
    );
    expect(link?.marks?.[0]?.attrs?.href).toBe("https://hasna.dev");
  });

  test("bullet list", () => {
    const doc = fromMarkdown("- one\n- two\n- three");
    expect(doc.content?.[0]?.type).toBe("bulletList");
    expect(doc.content?.[0]?.content?.length).toBe(3);
  });

  test("ordered list with start", () => {
    const doc = fromMarkdown("3. c\n4. d");
    expect(doc.content?.[0]).toMatchObject({ type: "orderedList", attrs: { start: 3 } });
  });

  test("nested list", () => {
    const doc = fromMarkdown("- parent\n  - child");
    const parentItem = doc.content?.[0]?.content?.[0];
    const nested = parentItem?.content?.find((n) => n.type === "bulletList");
    expect(nested).toBeDefined();
  });

  test("fenced code block with language", () => {
    const doc = fromMarkdown("```ts\nconst x = 1\n```");
    expect(doc.content?.[0]).toMatchObject({ type: "codeBlock", attrs: { language: "ts" } });
    expect(doc.content?.[0]?.content?.[0]?.text).toBe("const x = 1");
  });

  test("blockquote", () => {
    const doc = fromMarkdown("> quoted line");
    expect(doc.content?.[0]?.type).toBe("blockquote");
  });

  test("horizontal rule", () => {
    const doc = fromMarkdown("a\n\n---\n\nb");
    expect(doc.content?.some((n) => n.type === "horizontalRule")).toBe(true);
  });

  test("GFM table", () => {
    const doc = fromMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
    const table = doc.content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.content?.length).toBe(2);
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
  });
});

describe("toMarkdown", () => {
  test("serializes headings and emphasis", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hi" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }],
        },
      ],
    };
    const md = toMarkdown(doc);
    expect(md).toContain("# Hi");
    expect(md).toContain("**bold**");
  });
});

describe("markdown round-trips", () => {
  for (const md of [
    "# Heading",
    "A paragraph with **bold** and *italic* text.",
    "- a\n- b\n- c",
    "1. first\n2. second",
    "> a quote",
    "```js\nconsole.log(1)\n```",
    "[link](https://example.com)",
    "| h1 | h2 |\n| --- | --- |\n| a | b |",
  ]) {
    test(`stable: ${JSON.stringify(md).slice(0, 30)}`, () => {
      const once = roundtrip(md);
      const twice = roundtrip(once);
      expect(twice).toBe(once);
    });
  }
});
