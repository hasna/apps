import { describe, test, expect } from "bun:test";
import { renderInline, renderContent } from "./terminal-markdown";

describe("renderInline", () => {
  test("renders inline code with chalk formatting", () => {
    const result = renderInline("use `console.log` here");
    expect(result).toContain("console.log");
  });

  test("renders bold text", () => {
    const result = renderInline("this is **bold** text");
    expect(result).toContain("bold");
  });

  test("renders italic text", () => {
    const result = renderInline("this is *italic* text");
    expect(result).toContain("italic");
  });

  test("renders bold+italic text", () => {
    const result = renderInline("this is ***bolditalic*** text");
    expect(result).toContain("bolditalic");
  });

  test("renders strikethrough text", () => {
    const result = renderInline("this is ~~strikethrough~~ text");
    expect(result).toContain("strikethrough");
  });

  test("renders multiple inline formats", () => {
    const result = renderInline("use `code` and **bold** and *italic*");
    expect(result).toContain("code");
    expect(result).toContain("bold");
    expect(result).toContain("italic");
  });

  test("returns plain text unchanged", () => {
    const result = renderInline("hello world");
    expect(result).toContain("hello world");
  });
});

describe("renderContent", () => {
  test("renders headings", () => {
    const result = renderContent("# Heading 1\n## Heading 2\n### Heading 3");
    expect(result).toContain("Heading 1");
    expect(result).toContain("Heading 2");
    expect(result).toContain("Heading 3");
  });

  test("renders unordered lists", () => {
    const result = renderContent("- item one\n* item two\n+ item three");
    expect(result).toContain("item one");
    expect(result).toContain("item two");
    expect(result).toContain("item three");
  });

  test("renders ordered lists", () => {
    const result = renderContent("1. first\n2. second");
    expect(result).toContain("first");
    expect(result).toContain("second");
  });

  test("renders ordered lists with paren separator", () => {
    const result = renderContent("1) first\n2) second");
    expect(result).toContain("first");
    expect(result).toContain("second");
  });

  test("renders blockquotes", () => {
    const result = renderContent("> quoted text");
    expect(result).toContain("quoted text");
  });

  test("skips code block markers", () => {
    const result = renderContent("```\ncode\n```");
    expect(result).not.toContain("```");
  });

  test("preserves empty lines", () => {
    const result = renderContent("line1\n\nline2");
    expect(result).toContain("line1");
    expect(result).toContain("line2");
  });

  test("renders regular text", () => {
    const result = renderContent("just some text");
    expect(result).toContain("just some text");
  });

  test("renders mixed content", () => {
    const result = renderContent(`# Title

- list item with **bold**
1. ordered item
> quote

regular text`);
    expect(result).toContain("Title");
    expect(result).toContain("list item");
    expect(result).toContain("ordered item");
    expect(result).toContain("quote");
    expect(result).toContain("regular text");
  });

  test("handles inline formatting inside lists", () => {
    const result = renderContent("- use `code` in list");
    expect(result).toContain("code");
  });
});
