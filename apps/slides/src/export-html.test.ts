import { describe, expect, test } from "bun:test";
import { createDeck } from "./deck.js";
import {
  exportDeckHtml,
  renderSlidesFragment,
  looksLikeColor,
} from "./export-html.js";

describe("looksLikeColor", () => {
  test("recognizes colors and rejects image URLs", () => {
    expect(looksLikeColor("#ff0000")).toBe(true);
    expect(looksLikeColor("rgb(1,2,3)")).toBe(true);
    expect(looksLikeColor("black")).toBe(true);
    expect(looksLikeColor("https://x/y.png")).toBe(false);
    expect(looksLikeColor("images/bg.jpg")).toBe(false);
  });
});

describe("renderSlidesFragment", () => {
  test("markdown slides use data-markdown + textarea", () => {
    const deck = createDeck({ slides: [{ body: "# Hi" }] });
    const html = renderSlidesFragment(deck.slides);
    expect(html).toContain("<section data-markdown>");
    expect(html).toContain("<textarea data-template>");
    expect(html).toContain("# Hi");
  });

  test("html slides emit body verbatim with notes and fragments", () => {
    const deck = createDeck({
      slides: [
        {
          body: "<h1>Title</h1>",
          format: "html",
          notes: "speaker note",
          fragments: ["reveal me"],
        },
      ],
    });
    const html = renderSlidesFragment(deck.slides);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain('<aside class="notes">speaker note</aside>');
    expect(html).toContain('<p class="fragment">reveal me</p>');
  });

  test("vertical stacks nest sections", () => {
    const deck = createDeck();
    const top = deck.addSlide({ body: "Top", format: "html" });
    deck.addChild(top.id, { body: "Child", format: "html" });
    const html = renderSlidesFragment(deck.slides);
    // outer wrapper + two inner sections
    expect(html.match(/<section/g)?.length).toBe(3);
    expect(html.indexOf("Top")).toBeLessThan(html.indexOf("Child"));
  });

  test("background color vs image, transition and custom attributes", () => {
    const deck = createDeck({
      slides: [
        {
          body: "x",
          format: "html",
          background: "#123456",
          transition: "zoom",
          attributes: { "data-state": "alert" },
        },
        { body: "y", format: "html", background: "bg.png" },
      ],
    });
    const html = renderSlidesFragment(deck.slides);
    expect(html).toContain('data-background-color="#123456"');
    expect(html).toContain('data-transition="zoom"');
    expect(html).toContain('data-state="alert"');
    expect(html).toContain('data-background-image="bg.png"');
  });

  test("markdown fragments and notes are embedded in the textarea", () => {
    const deck = createDeck({
      slides: [{ body: "# Title", fragments: ["one"], notes: "hello" }],
    });
    const html = renderSlidesFragment(deck.slides);
    expect(html).toContain('<!-- .element: class="fragment" -->');
    expect(html).toContain("Note:\nhello");
  });

  test("guards a literal closing textarea tag in markdown", () => {
    const deck = createDeck({ slides: [{ body: "before </textarea> after" }] });
    const html = renderSlidesFragment(deck.slides);
    expect(html).not.toContain("</textarea> after");
    expect(html).toContain("&lt;/textarea");
  });
});

describe("exportDeckHtml", () => {
  test("produces a complete CDN document", () => {
    const deck = createDeck({ title: "My Talk", theme: "moon", slides: [{ body: "# Hi" }] });
    const html = exportDeckHtml(deck.data);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>My Talk</title>");
    expect(html).toContain('<div class="reveal">');
    expect(html).toContain('<div class="slides">');
    expect(html).toContain("cdn.jsdelivr.net/npm/reveal.js@");
    expect(html).toContain("/dist/theme/moon.css");
    expect(html).toContain("Reveal.initialize(");
    expect(html).toContain("plugin/markdown/markdown.js");
    expect(html).toContain("plugin/notes/notes.js");
  });

  test("serializes deck config into the init call", () => {
    const deck = createDeck({ config: { hash: true, controls: false } });
    const html = exportDeckHtml(deck.data);
    expect(html).toContain('"controls":false');
    expect(html).toContain('"hash":true');
  });

  test("can disable plugins", () => {
    const deck = createDeck({ slides: [{ body: "hi" }] });
    const html = exportDeckHtml(deck.data, {
      includeNotesPlugin: false,
      includeHighlightPlugin: false,
    });
    expect(html).not.toContain("plugin/notes/notes.js");
    expect(html).not.toContain("plugin/highlight/highlight.js");
    expect(html).toContain("plugin/markdown/markdown.js");
    expect(html).toContain("plugins: [RevealMarkdown]");
  });

  test("inline assets produce a self-contained document", () => {
    const deck = createDeck({ slides: [{ body: "hi" }] });
    const html = exportDeckHtml(deck.data, {
      assets: {
        revealCss: "/*core*/",
        themeCss: "/*theme*/",
        revealJs: "/*js*/",
        markdownJs: "/*md*/",
      },
      includeNotesPlugin: false,
      includeHighlightPlugin: false,
    });
    expect(html).toContain("<style>/*core*/</style>");
    expect(html).toContain("<style>/*theme*/</style>");
    expect(html).toContain("<script>/*js*/</script>");
    expect(html).toContain("<script>/*md*/</script>");
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain("<link rel=\"stylesheet\"");
  });

  test("escapes the document title", () => {
    const deck = createDeck({ title: "<script>x</script>" });
    const html = exportDeckHtml(deck.data);
    expect(html).toContain("<title>&lt;script&gt;x&lt;/script&gt;</title>");
  });
});
