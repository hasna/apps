import { describe, expect, test } from "bun:test";
import { fromHTML, toHTML } from "./html.js";
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
});
