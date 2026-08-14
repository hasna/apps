import { describe, expect, test } from "bun:test";
import {
  assertValidDoc,
  bold,
  bulletList,
  codeBlock,
  DocumentValidationError,
  emptyDoc,
  heading,
  isValidDoc,
  link,
  listItem,
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
});
