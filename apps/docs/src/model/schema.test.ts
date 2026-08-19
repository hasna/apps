import { describe, expect, test } from "bun:test";
import {
  assertValidDoc,
  bold,
  bulletList,
  cloneNode,
  codeBlock,
  DocumentValidationError,
  emptyDoc,
  heading,
  horizontalRule,
  isValidDoc,
  link,
  listItem,
  orderedList,
  paragraph,
  text,
} from "./schema.js";

describe("builders", () => {
  test("text with and without marks", () => {
    expect(text("hi")).toEqual({ type: "text", text: "hi" });
    expect(text("hi", [bold()])).toEqual({
      type: "text",
      text: "hi",
      marks: [{ type: "bold" }],
    });
  });

  test("heading carries level attr", () => {
    expect(heading(2, [text("Title")])).toEqual({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Title" }],
    });
  });

  test("codeBlock stores language and raw text", () => {
    const node = codeBlock("const x = 1", "ts");
    expect(node.attrs).toEqual({ language: "ts" });
    expect(node.content).toEqual([{ type: "text", text: "const x = 1" }]);
  });

  test("link mark requires href", () => {
    expect(link("https://x.dev")).toEqual({
      type: "link",
      attrs: { href: "https://x.dev" },
    });
  });

  test("emptyDoc is a doc with one empty paragraph", () => {
    expect(emptyDoc()).toEqual({ type: "doc", content: [{ type: "paragraph", content: [] }] });
  });

  test("text with an empty marks array omits the marks field", () => {
    expect(text("plain", [])).toEqual({ type: "text", text: "plain" });
  });

  test("codeBlock with empty code has an empty content array", () => {
    expect(codeBlock("")).toEqual({ type: "codeBlock", attrs: { language: null }, content: [] });
    expect(codeBlock("x", "ts")).toMatchObject({ attrs: { language: "ts" } });
  });

  test("horizontalRule is a bare leaf node", () => {
    expect(horizontalRule()).toEqual({ type: "horizontalRule" });
  });

  test("orderedList carries its start attr", () => {
    expect(orderedList([], 3)).toMatchObject({ attrs: { start: 3 } });
  });
});

describe("validation", () => {
  test("accepts a well-formed document", () => {
    const doc = {
      type: "doc",
      content: [heading(1, [text("H")]), bulletList([listItem([paragraph([text("a")])])])],
    };
    expect(() => assertValidDoc(doc)).not.toThrow();
    expect(isValidDoc(doc)).toBe(true);
  });

  test("rejects a non-doc root", () => {
    expect(() => assertValidDoc({ type: "paragraph" })).toThrow(DocumentValidationError);
    expect(isValidDoc({ type: "paragraph" })).toBe(false);
  });

  test("rejects unknown node types", () => {
    expect(() =>
      assertValidDoc({ type: "doc", content: [{ type: "marquee" }] }),
    ).toThrow(/unknown node type/);
  });

  test("rejects a heading without a valid level", () => {
    expect(() =>
      assertValidDoc({ type: "doc", content: [{ type: "heading", content: [] }] }),
    ).toThrow(/attrs.level/);
  });

  test("rejects a link mark without href", () => {
    expect(() =>
      assertValidDoc({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link" }] }] }],
      }),
    ).toThrow(/link mark requires/);
  });

  test("rejects a link mark with a non-string href", () => {
    expect(() =>
      assertValidDoc({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: 42 } }] }] }],
      }),
    ).toThrow(/link mark requires a string href/);
  });

  test("rejects an unknown mark type", () => {
    expect(() =>
      assertValidDoc({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "underline" }] }] }],
      }),
    ).toThrow(/unknown mark type/);
  });

  test("rejects a mark that is not an object", () => {
    expect(() =>
      assertValidDoc({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: ["bold"] }] }],
      }),
    ).toThrow(/mark must be an object/);
  });

  test("rejects a text node without a string text", () => {
    expect(() =>
      assertValidDoc({ type: "doc", content: [{ type: "text" }] }),
    ).toThrow(/text node requires a string text/);
  });

  test("rejects a text node whose marks field is not an array", () => {
    expect(() =>
      assertValidDoc({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: "bold" }] }],
      }),
    ).toThrow(/marks must be an array/);
  });

  test("rejects heading levels out of the 1..6 range", () => {
    for (const level of [0, 7, -1]) {
      expect(() =>
        assertValidDoc({ type: "doc", content: [{ type: "heading", attrs: { level }, content: [] }] }),
      ).toThrow(/attrs\.level between 1 and 6/);
    }
    expect(isValidDoc({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [] }] })).toBe(true);
    expect(isValidDoc({ type: "doc", content: [{ type: "heading", attrs: { level: 6 }, content: [] }] })).toBe(true);
  });

  test("rejects a non-array doc content", () => {
    expect(() => assertValidDoc({ type: "doc", content: { 0: paragraph() } })).toThrow(/doc\.content must be an array/);
  });

  test("rejects a non-array node content and non-object nodes", () => {
    expect(() =>
      assertValidDoc({ type: "doc", content: [{ type: "paragraph", content: "nope" }] }),
    ).toThrow(/content must be an array/);
    expect(() => assertValidDoc({ type: "doc", content: [null] })).toThrow(/node must be an object/);
    expect(() => assertValidDoc({ type: "doc", content: ["paragraph"] })).toThrow(/node must be an object/);
  });

  test("validates nested content deep inside blockquotes", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "ok", marks: [{ type: "bold" }] }] }] },
      ],
    };
    expect(isValidDoc(doc)).toBe(true);
    const bad = {
      type: "doc",
      content: [{ type: "blockquote", content: [{ type: "marquee" }] }],
    };
    expect(() => assertValidDoc(bad)).toThrow(/unknown node type/);
  });

  test("a doc with no content array is valid", () => {
    expect(isValidDoc({ type: "doc" })).toBe(true);
  });

  test("isValidDoc reports the first error without throwing", () => {
    expect(isValidDoc({ type: "doc", content: [{ type: "heading", content: [] }] })).toBe(false);
  });
});

describe("cloneNode", () => {
  test("returns a deep copy that is independent of the source", () => {
    const node = paragraph([text("a", [bold()])]);
    const copy = cloneNode(node);
    copy.content![0]!.text = "b";
    copy.content![0]!.marks = [];
    expect(node.content?.[0]?.text).toBe("a");
    expect(node.content?.[0]?.marks).toEqual([{ type: "bold" }]);
  });

  test("deep-copies nested structures", () => {
    const node = bulletList([listItem([paragraph([text("x")])])]);
    const copy = cloneNode(node);
    expect(copy).toEqual(node);
    copy.content![0]!.content![0]!.content![0]!.text = "y";
    expect(node.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe("x");
  });
});
