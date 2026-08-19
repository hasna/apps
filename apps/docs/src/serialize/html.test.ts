import { describe, expect, test } from "bun:test";
import { fromHTML, toHTML } from "./html.js";
import { toMarkdown } from "./markdown.js";
import { bold, heading, link, paragraph, text } from "../model/schema.js";
import type { DocJSON } from "../types/index.js";

describe("toHTML", () => {
  test("escapes text content", () => {
    const doc: DocJSON = { type: "doc", content: [paragraph([text("a < b & c > d")])] };
    expect(toHTML(doc)).toBe("<p>a &lt; b &amp; c &gt; d</p>");
  });

  test("nests marks deterministically (link outermost)", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [paragraph([text("x", [bold(), link("https://h.dev")])])],
    };
    expect(toHTML(doc)).toBe('<p><a href="https://h.dev"><strong>x</strong></a></p>');
  });

  test("headings and code blocks", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [
        heading(2, [text("Title")]),
        { type: "codeBlock", attrs: { language: "js" }, content: [text("a<b")] },
      ],
    };
    const html = toHTML(doc);
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain('<pre><code class="language-js">a&lt;b</code></pre>');
  });
});

describe("fromHTML", () => {
  test("parses paragraphs and marks", () => {
    const doc = fromHTML("<p>Hello <strong>bold</strong> and <em>italic</em></p>");
    const marks = (doc.content?.[0]?.content ?? []).flatMap(
      (n) => n.marks?.map((m) => m.type) ?? [],
    );
    expect(marks).toContain("bold");
    expect(marks).toContain("italic");
  });

  test("parses links with href", () => {
    const doc = fromHTML('<p><a href="https://hasna.dev">site</a></p>');
    const node = doc.content?.[0]?.content?.[0];
    expect(node?.marks?.[0]).toMatchObject({ type: "link", attrs: { href: "https://hasna.dev" } });
  });

  test("parses lists", () => {
    const doc = fromHTML("<ul><li>one</li><li>two</li></ul>");
    expect(doc.content?.[0]?.type).toBe("bulletList");
    expect(doc.content?.[0]?.content?.length).toBe(2);
  });

  test("parses ordered list start", () => {
    const doc = fromHTML('<ol start="5"><li>x</li></ol>');
    expect(doc.content?.[0]).toMatchObject({ type: "orderedList", attrs: { start: 5 } });
  });

  test("parses headings", () => {
    const doc = fromHTML("<h3>Heading</h3>");
    expect(doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 3 } });
  });

  test("parses code blocks with language", () => {
    const doc = fromHTML('<pre><code class="language-ts">const x = 1</code></pre>');
    expect(doc.content?.[0]).toMatchObject({ type: "codeBlock", attrs: { language: "ts" } });
    expect(doc.content?.[0]?.content?.[0]?.text).toBe("const x = 1");
  });

  test("decodes entities", () => {
    const doc = fromHTML("<p>a &amp; b &lt; c &#39;q&#39;</p>");
    expect(doc.content?.[0]?.content?.[0]?.text).toBe("a & b < c 'q'");
  });

  test("handles hard breaks", () => {
    const doc = fromHTML("<p>a<br>b</p>");
    const types = (doc.content?.[0]?.content ?? []).map((n) => n.type);
    expect(types).toContain("hardBreak");
  });

  test("parses tables", () => {
    const doc = fromHTML("<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>");
    expect(doc.content?.[0]?.type).toBe("table");
    expect(doc.content?.[0]?.content?.length).toBe(2);
  });

  test("table with thead/tbody sections flattens into rows", () => {
    const doc = fromHTML(
      "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>",
    );
    const table = doc.content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.content?.length).toBe(2);
    expect(table?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(table?.content?.[1]?.content?.[0]?.type).toBe("tableCell");
  });

  test("decodes numeric character references in hex and decimal", () => {
    const doc = fromHTML("<p>&#65;&#x42;&#x22;</p>");
    expect(doc.content?.[0]?.content?.[0]?.text).toBe("AB\"");
  });

  test("decodes nbsp to a regular space", () => {
    const doc = fromHTML("<p>a&nbsp;b</p>");
    expect(doc.content?.[0]?.content?.[0]?.text).toBe("a b");
  });

  test("unknown named entities are preserved literally", () => {
    const doc = fromHTML("<p>a &bogus; b</p>");
    expect(doc.content?.[0]?.content?.[0]?.text).toBe("a &bogus; b");
  });

  test("out-of-range numeric entities do not crash and are preserved literally", () => {
    // Regression: &#1114112; / &#x110000; exceeded the Unicode scalar range and
    // threw RangeError from String.fromCodePoint, crashing fromHTML.
    for (const entity of ["&#1114112;", "&#x110000;"]) {
      const doc = fromHTML(`<p>x ${entity} y</p>`);
      expect(doc.content?.[0]?.content?.[0]?.text).toBe(`x ${entity} y`);
    }
  });

  test("the maximum valid code point still decodes", () => {
    const doc = fromHTML("<p>&#1114111;</p>");
    expect(doc.content?.[0]?.content?.[0]?.text).toBe("\u{10ffff}");
  });

  test("ol start attribute is preserved", () => {
    const doc = fromHTML('<ol start="3"><li>c</li><li>d</li></ol>');
    expect(doc.content?.[0]).toMatchObject({ type: "orderedList", attrs: { start: 3 } });
  });

  test("nested lists parse", () => {
    const doc = fromHTML("<ul><li>a<ul><li>b</li></ul></li></ul>");
    const li = doc.content?.[0]?.content?.[0];
    expect(li?.content?.some((n) => n.type === "bulletList")).toBe(true);
  });

  test("comments and doctype are dropped", () => {
    const doc = fromHTML("<!DOCTYPE html><p>a<!-- note -->b</p>");
    // The comment splits the paragraph into two text nodes; concatenate.
    const textOf = (p: unknown) =>
      ((p as { content?: { text?: string }[] }).content ?? []).map((n) => n.text ?? "").join("");
    expect(textOf(doc.content?.[0])).toBe("ab");
  });

  test("mismatched closing tags and unclosed blocks are tolerated", () => {
    const textOf = (p: unknown) =>
      ((p as { content?: { text?: string }[] }).content ?? []).map((n) => n.text ?? "").join("");
    // </div> closes nothing (stack is [doc, p]); text is kept.
    expect(textOf(fromHTML("<p>a</div>b").content?.[0])).toBe("ab");
    // An unclosed <p> nests the second <p> inside the first as inline content.
    const doc = fromHTML("<p>a<p>b");
    expect(doc.content?.length).toBe(1);
    expect(textOf(doc.content?.[0])).toBe("ab");
  });

  test("self-closing br and void img are handled", () => {
    const doc = fromHTML("<p>a<br/>b<img src='x'>c</p>");
    const types = (doc.content?.[0]?.content ?? []).map((n) => n.type);
    expect(types).toContain("hardBreak");
    expect(types.filter((t) => t === "hardBreak").length).toBe(1);
  });

  test("single-quoted and unquoted attribute values parse", () => {
    expect(fromHTML("<a href='x'>l</a>").content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.href).toBe("x");
    expect(fromHTML("<a href=x>l</a>").content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.href).toBe("x");
  });

  test("entities inside attribute values decode and re-escape on export", () => {
    const doc = fromHTML('<a href="a&amp;b">l</a>');
    expect(doc.content?.[0]?.content?.[0]?.marks?.[0]?.attrs?.href).toBe("a&b");
    expect(toHTML(doc)).toContain('href="a&amp;b"');
  });

  test("span/u/mark descend while keeping marks; div/section/article flatten", () => {
    expect(fromHTML('<p><span class="x">t</span></p>').content?.[0]?.content?.[0]?.text).toBe("t");
    const flat = fromHTML("<div><p>a</p><section><p>b</p></section></div>");
    expect(flat.content?.length).toBe(2);
  });

  test("tag names are case-insensitive", () => {
    const doc = fromHTML("<P>a</P><H1>B</H1>");
    expect(doc.content?.[0]?.type).toBe("paragraph");
    expect(doc.content?.[1]?.type).toBe("heading");
  });

  test("empty HTML produces a single empty paragraph", () => {
    expect(fromHTML("")).toEqual({ type: "doc", content: [{ type: "paragraph", content: [] }] });
  });

  test("text before any block element becomes a paragraph", () => {
    const doc = fromHTML("hello <p>world</p>");
    expect(doc.content?.[0]?.content?.[0]?.text).toBe("hello ");
    expect(doc.content?.[1]?.content?.[0]?.text).toBe("world");
  });

  test("whitespace-only text between blocks is dropped", () => {
    const doc = fromHTML("<p>a</p>   \n  <p>b</p>");
    expect(doc.content?.length).toBe(2);
  });
});

describe("html round-trip", () => {
  test("export then import preserves structure", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [
        heading(1, [text("Title")]),
        paragraph([text("Some "), text("bold", [bold()]), text(" text.")]),
      ],
    };
    const back = fromHTML(toHTML(doc));
    expect(back.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    const marks = (back.content?.[1]?.content ?? []).flatMap(
      (n) => n.marks?.map((m) => m.type) ?? [],
    );
    expect(marks).toContain("bold");
  });

  test("link attrs other than href survive export; import keeps href", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [
        paragraph([
          text("x", [link("https://h.dev", { target: "_blank", rel: "noopener" })]),
        ]),
      ],
    };
    const html = toHTML(doc);
    expect(html).toContain('href="https://h.dev"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    // The import path intentionally reconstructs only the href (see
    // inlineFromTokens); target/rel are an export-only surface.
    const back = fromHTML(html);
    const mark = back.content?.[0]?.content?.[0]?.marks?.[0];
    expect(mark?.attrs?.href).toBe("https://h.dev");
  });

  test("html import -> markdown export of a table keeps cells", () => {
    const doc = fromHTML("<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>");
    const md = toMarkdown(doc);
    expect(md).toContain("| a | b |");
    expect(md).toContain("| 1 | 2 |");
  });
});
