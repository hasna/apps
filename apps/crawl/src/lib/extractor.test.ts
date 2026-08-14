import { describe, expect, it } from "bun:test";
import { extractContent } from "./extractor.js";

const BASE = "https://example.com";

// ─── Title extraction ─────────────────────────────────────────────────────────

describe("title extraction", () => {
  it("extracts from <title> tag", () => {
    const html = "<html><head><title>My Page Title</title></head><body></body></html>";
    const result = extractContent(html, BASE);
    expect(result.title).toBe("My Page Title");
  });

  it("extracts og:title when no <title> tag", () => {
    const html = `<html><head>
      <meta property="og:title" content="OG Title Here">
    </head><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.title).toBe("OG Title Here");
  });

  it("falls back to first <h1>", () => {
    const html = `<html><head></head><body><h1>Heading One</h1></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.title).toBe("Heading One");
  });

  it("prefers <title> over og:title", () => {
    const html = `<html><head>
      <title>Real Title</title>
      <meta property="og:title" content="OG Title">
    </head><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.title).toBe("Real Title");
  });

  it("returns null when no title found", () => {
    const html = "<html><head></head><body><p>No title here</p></body></html>";
    const result = extractContent(html, BASE);
    expect(result.title).toBeNull();
  });
});

// ─── Description extraction ───────────────────────────────────────────────────

describe("description extraction", () => {
  it("extracts from <meta name='description'>", () => {
    const html = `<html><head>
      <meta name="description" content="Page description here">
    </head><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.description).toBe("Page description here");
  });

  it("extracts from og:description as fallback", () => {
    const html = `<html><head>
      <meta property="og:description" content="OG description">
    </head><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.description).toBe("OG description");
  });

  it("returns null when no description", () => {
    const html = "<html><head></head><body></body></html>";
    const result = extractContent(html, BASE);
    expect(result.description).toBeNull();
  });
});

// ─── Text extraction ──────────────────────────────────────────────────────────

describe("text extraction", () => {
  it("extracts visible text content", () => {
    const html = `<html><body><p>Hello world</p></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.text).toContain("Hello world");
  });

  it("removes <script> content", () => {
    const html = `<html><body>
      <p>Visible text</p>
      <script>var x = "should not appear";</script>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.text).toContain("Visible text");
    expect(result.text).not.toContain("should not appear");
  });

  it("removes <style> content", () => {
    const html = `<html><body>
      <p>Content here</p>
      <style>.hidden { display: none; }</style>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.text).toContain("Content here");
    expect(result.text).not.toContain("display: none");
  });

  it("removes <nav> content", () => {
    const html = `<html><body>
      <nav>Home About Contact</nav>
      <main><p>Main content</p></main>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.text).toContain("Main content");
    expect(result.text).not.toContain("Home About Contact");
  });

  it("collapses whitespace", () => {
    const html = `<html><body><p>  lots   of   spaces  </p></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.text).toBe("lots of spaces");
  });

  it("decodes HTML entities", () => {
    const html = `<html><body><p>AT&amp;T &lt;rocks&gt;</p></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.text).toContain("AT&T");
    expect(result.text).toContain("<rocks>");
  });
});

// ─── Link extraction ──────────────────────────────────────────────────────────

describe("link extraction", () => {
  it("extracts absolute links", () => {
    const html = `<html><body>
      <a href="https://example.org/page">External</a>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]?.href).toBe("https://example.org/page");
    expect(result.links[0]?.text).toBe("External");
  });

  it("resolves relative URLs against baseUrl", () => {
    const html = `<html><body>
      <a href="/about">About</a>
      <a href="blog/post">Blog</a>
    </body></html>`;
    const result = extractContent(html, BASE);
    const hrefs = result.links.map((l) => l.href);
    expect(hrefs).toContain("https://example.com/about");
    expect(hrefs).toContain("https://example.com/blog/post");
  });

  it("ignores anchor-only and javascript: links", () => {
    const html = `<html><body>
      <a href="#section">Jump</a>
      <a href="javascript:void(0)">JS</a>
      <a href="/valid">Valid</a>
    </body></html>`;
    const result = extractContent(html, BASE);
    const hrefs = result.links.map((l) => l.href);
    expect(hrefs).not.toContain("#section");
    expect(hrefs).not.toContain("javascript:void(0)");
    expect(hrefs).toContain("https://example.com/valid");
  });

  it("extracts link text correctly", () => {
    const html = `<html><body>
      <a href="/page"><span>Click <strong>here</strong></span></a>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.links[0]?.text).toBe("Click here");
  });
});

// ─── Markdown conversion ──────────────────────────────────────────────────────

describe("markdown conversion", () => {
  it("converts headings", () => {
    const html = `<html><body>
      <h1>Title</h1>
      <h2>Subtitle</h2>
      <h3>Section</h3>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.markdown).toContain("# Title");
    expect(result.markdown).toContain("## Subtitle");
    expect(result.markdown).toContain("### Section");
  });

  it("converts bold and italic", () => {
    const html = `<html><body>
      <p><strong>bold</strong> and <em>italic</em></p>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.markdown).toContain("**bold**");
    expect(result.markdown).toContain("*italic*");
  });

  it("converts links", () => {
    const html = `<html><body>
      <a href="https://example.org">Visit</a>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.markdown).toContain("[Visit](https://example.org/)");
  });

  it("converts unordered lists", () => {
    const html = `<html><body>
      <ul>
        <li>Item A</li>
        <li>Item B</li>
      </ul>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.markdown).toContain("- Item A");
    expect(result.markdown).toContain("- Item B");
  });

  it("converts ordered lists", () => {
    const html = `<html><body>
      <ol>
        <li>First</li>
        <li>Second</li>
      </ol>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.markdown).toContain("1. First");
    expect(result.markdown).toContain("2. Second");
  });

  it("converts inline code", () => {
    const html = `<html><body><p>Use <code>npm install</code></p></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.markdown).toContain("`npm install`");
  });

  it("converts blockquote", () => {
    const html = `<html><body><blockquote>A wise saying</blockquote></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.markdown).toContain("> A wise saying");
  });

  it("converts hr", () => {
    const html = `<html><body><p>Before</p><hr/><p>After</p></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.markdown).toContain("---");
  });
});

// ─── Word count ───────────────────────────────────────────────────────────────

describe("word count", () => {
  it("counts words in extracted text", () => {
    const html = `<html><body><p>one two three four five</p></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.wordCount).toBe(5);
  });

  it("returns 0 for empty content", () => {
    const html = `<html><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.wordCount).toBe(0);
  });

  it("does not count script content", () => {
    const html = `<html><body>
      <script>var a = 1; var b = 2; var c = 3;</script>
      <p>only three words</p>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.wordCount).toBe(3);
  });
});

// ─── Metadata extraction ──────────────────────────────────────────────────────

describe("metadata extraction", () => {
  it("extracts open graph tags", () => {
    const html = `<html><head>
      <meta property="og:title" content="OG Title">
      <meta property="og:description" content="OG Desc">
      <meta property="og:image" content="https://example.com/img.png">
    </head><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.metadata.openGraph?.["og:title"]).toBe("OG Title");
    expect(result.metadata.openGraph?.["og:description"]).toBe("OG Desc");
    expect(result.metadata.openGraph?.["og:image"]).toBe("https://example.com/img.png");
  });

  it("extracts twitter card tags", () => {
    const html = `<html><head>
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="Tweet Title">
    </head><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.metadata.twitterCard?.["twitter:card"]).toBe("summary_large_image");
    expect(result.metadata.twitterCard?.["twitter:title"]).toBe("Tweet Title");
  });

  it("extracts canonical URL", () => {
    const html = `<html><head>
      <link rel="canonical" href="https://example.com/canonical">
    </head><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.metadata.canonicalUrl).toBe("https://example.com/canonical");
  });

  it("extracts JSON-LD", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"Article","name":"Test"}</script>
    </head><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.metadata.jsonLd).toHaveLength(1);
    const item = result.metadata.jsonLd?.[0] as Record<string, string>;
    expect(item?.["@type"]).toBe("Article");
  });

  it("extracts lang attribute", () => {
    const html = `<html lang="en-US"><head></head><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.metadata.lang).toBe("en-US");
  });

  it("extracts headings into metadata", () => {
    const html = `<html><body>
      <h1>Main</h1>
      <h2>Sub</h2>
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.metadata.headings).toBeDefined();
    expect(result.metadata.headings?.some((h) => h.text === "Main" && h.level === 1)).toBe(true);
    expect(result.metadata.headings?.some((h) => h.text === "Sub" && h.level === 2)).toBe(true);
  });

  it("handles malformed JSON-LD without throwing", () => {
    const html = `<html><head>
      <script type="application/ld+json">{ invalid json }</script>
    </head><body></body></html>`;
    expect(() => extractContent(html, BASE)).not.toThrow();
    const result = extractContent(html, BASE);
    expect(result.metadata.jsonLd ?? []).toHaveLength(0);
  });

  it("extracts robots meta", () => {
    const html = `<html><head>
      <meta name="robots" content="noindex, nofollow">
    </head><body></body></html>`;
    const result = extractContent(html, BASE);
    expect(result.metadata.robots).toBe("noindex, nofollow");
  });
});

// ─── Image extraction ─────────────────────────────────────────────────────────

describe("image extraction", () => {
  it("extracts images with absolute src", () => {
    const html = `<html><body>
      <img src="https://example.com/photo.jpg" alt="A photo">
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.src).toBe("https://example.com/photo.jpg");
    expect(result.images[0]?.alt).toBe("A photo");
  });

  it("resolves relative image src", () => {
    const html = `<html><body>
      <img src="/images/logo.png" alt="Logo">
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.images[0]?.src).toBe("https://example.com/images/logo.png");
  });

  it("uses empty string for missing alt", () => {
    const html = `<html><body>
      <img src="/img.png">
    </body></html>`;
    const result = extractContent(html, BASE);
    expect(result.images[0]?.alt).toBe("");
  });
});
