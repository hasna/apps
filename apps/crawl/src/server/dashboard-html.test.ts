import { describe, expect, it } from "bun:test";

// Regression: the dashboard rendered stored, crawler-controlled fields (page
// titles decoded from HTML entities, URLs, snippets) into innerHTML without
// escaping (release-review P1 for @hasna/crawl@0.4.19 — stored XSS).
// Every user-controlled interpolation must pass through escapeHtml().

describe("dashboard HTML escaping", () => {
  it("defines an escapeHtml helper in the dashboard script", async () => {
    const { DASHBOARD_HTML } = await import("./index.js");
    expect(DASHBOARD_HTML).toContain("function escapeHtml");
    // The escape set must cover the five dangerous characters.
    const fn = DASHBOARD_HTML.slice(
      DASHBOARD_HTML.indexOf("function escapeHtml"),
      DASHBOARD_HTML.indexOf("function escapeHtml") + 400
    );
    for (const ch of ["&lt;", "&gt;", "&amp;", "&quot;", "&#39;"]) {
      expect(fn).toContain(ch);
    }
  });

  it("escapes every user-controlled field in the crawls table", async () => {
    const { DASHBOARD_HTML } = await import("./index.js");
    const crawlsBlock = DASHBOARD_HTML.split("crawls-body").pop()!;
    expect(crawlsBlock).toContain("escapeHtml(c.url)");
    expect(crawlsBlock).toContain("escapeHtml(c.status)");
  });

  it("escapes every user-controlled field in the search results", async () => {
    const { DASHBOARD_HTML } = await import("./index.js");
    const searchBlock = DASHBOARD_HTML.split("results').innerHTML").pop()!;
    expect(searchBlock).toContain("escapeHtml(r.page.title || r.page.url)");
    expect(searchBlock).toContain("escapeHtml(r.page.url)");
    expect(searchBlock).toContain("escapeHtml(r.snippet)");
  });
});
