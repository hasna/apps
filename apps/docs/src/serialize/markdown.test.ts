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

  test("double-underscore emphasis", () => {
    expect(fromMarkdown("__bold__").content?.[0]?.content?.[0]?.marks).toContainEqual({ type: "bold" });
    expect(fromMarkdown("_em_").content?.[0]?.content?.[0]?.marks).toContainEqual({ type: "italic" });
  });

  test("combined bold+italic parses to two marks on one node", () => {
    const marks = fromMarkdown("***both***").content?.[0]?.content?.[0]?.marks;
    expect(marks).toEqual(expect.arrayContaining([{ type: "bold" }, { type: "italic" }]));
  });

  test("inline code spanning a backtick via a doubled fence", () => {
    const node = fromMarkdown("``a ` b``").content?.[0]?.content?.[0];
    expect(node).toMatchObject({ type: "text", text: "a ` b", marks: [{ type: "code" }] });
  });

  test("link containing emphasis keeps both marks", () => {
    const node = fromMarkdown("[**bold**](https://x)").content?.[0]?.content?.[0];
    expect(node?.marks).toEqual(
      expect.arrayContaining([
        { type: "link", attrs: { href: "https://x" } },
        { type: "bold" },
      ]),
    );
  });

  test("hard break from two trailing spaces", () => {
    const nodes = fromMarkdown("a  \nb").content?.[0]?.content ?? [];
    expect(nodes[1]).toMatchObject({ type: "hardBreak" });
  });

  test("escaped markdown characters parse as literal text", () => {
    const nodes = fromMarkdown("\\*literal\\* and \\_under\\_").content?.[0]?.content ?? [];
    expect(nodes[0]?.text).toBe("*literal* and _under_");
    expect(nodes[0]?.marks).toBeUndefined();
  });

  test("snake_case text survives a markdown roundtrip", () => {
    expect(toMarkdown(fromMarkdown("snake_case word")).trim()).toContain("snake\\_case");
    expect(toMarkdown(fromMarkdown(toMarkdown(fromMarkdown("snake_case word")))).trim()).toContain("snake\\_case");
  });

  test("tilde-fenced code block", () => {
    const doc = fromMarkdown("~~~js\nx=1\n~~~");
    expect(doc.content?.[0]).toMatchObject({ type: "codeBlock", attrs: { language: "js" } });
  });

  test("CRLF input is normalized to LF", () => {
    const doc = fromMarkdown("# H\r\n\r\nP");
    expect(doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(doc.content?.[1]?.content?.[0]?.text).toBe("P");
  });

  test("empty and whitespace-only input produce a single empty paragraph", () => {
    expect(fromMarkdown("")).toEqual({ type: "doc", content: [{ type: "paragraph", content: [] }] });
    expect(fromMarkdown("   \n\n  ")).toEqual({ type: "doc", content: [{ type: "paragraph", content: [] }] });
  });

  test("heading with trailing hashes parses cleanly", () => {
    const doc = fromMarkdown("# Title ##");
    expect(doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] });
  });

  test("ordered list with ) markers and non-1 start", () => {
    const doc = fromMarkdown("3) c\n4) d");
    expect(doc.content?.[0]).toMatchObject({ type: "orderedList", attrs: { start: 3 } });
    expect(doc.content?.[0]?.content?.length).toBe(2);
  });

  test("table cell with an escaped pipe roundtrips", () => {
    const md = "| a | b |\n| --- | --- |\n| x \\| y | 2 |";
    expect(toMarkdown(fromMarkdown(md)).trim()).toBe(md);
  });

  test("unclosed code fence consumes the rest of the input", () => {
    const doc = fromMarkdown("```js\nunclosed");
    expect(doc.content?.[0]).toMatchObject({ type: "codeBlock", attrs: { language: "js" } });
    expect(doc.content?.[0]?.content?.[0]?.text).toBe("unclosed");
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

  test("escapes markdown-significant characters in text", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a * b [c] ~d`" }] }],
    };
    const md = toMarkdown(doc);
    expect(md).toContain("a \\* b \\[c\\] \\~d\\`");
  });

  test("a code block with language serializes with a fence and keeps raw text", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [{ type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "x < y & z" }] }],
    };
    expect(toMarkdown(doc).trim()).toBe("```ts\nx < y & z\n```");
  });

  test("link marks serialize with href", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://x.dev" } }] }] }],
    };
    expect(toMarkdown(doc).trim()).toBe("[site](https://x.dev)");
  });

  test("combined bold+italic marks roundtrip without losing marks", () => {
    // Regression: a text node with bold+italic used to serialize to `***b***`,
    // which the parser could not read back (italic was lost, literal asterisks
    // appeared). The exported form must re-parse to the same marks.
    const doc: DocJSON = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "b", marks: [{ type: "bold" }, { type: "italic" }] }] }],
    };
    const md = toMarkdown(doc).trim();
    expect(md).toBe("***b***");
    const back = fromMarkdown(md);
    const node = back.content?.[0]?.content?.[0];
    expect(node?.text).toBe("b");
    expect(node?.marks).toEqual(
      expect.arrayContaining([{ type: "bold" }, { type: "italic" }]),
    );
  });

  test("a bold span containing italic nested nodes roundtrips stably", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a ", marks: [{ type: "bold" }] },
            { type: "text", text: "b", marks: [{ type: "bold" }, { type: "italic" }] },
            { type: "text", text: " c", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    const md = toMarkdown(doc).trim();
    expect(roundtrip(md)).toBe(md);
    const back = fromMarkdown(md);
    const marks = (back.content?.[0]?.content ?? []).flatMap((n) => n.marks?.map((m) => m.type) ?? []);
    expect(marks).toContain("bold");
    expect(marks).toContain("italic");
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
