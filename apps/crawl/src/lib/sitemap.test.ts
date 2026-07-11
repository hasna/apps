import { afterEach, describe, expect, it } from "bun:test";
import { fetchSitemap } from "./sitemap.js";

const servers: Bun.Server[] = [];

function serveSitemap(
  handler: (url: URL) => Response
): string {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return handler(new URL(req.url));
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

describe("fetchSitemap", () => {
  it("decodes XML entities in sitemap URL entries", async () => {
    const baseUrl = serveSitemap(() => new Response(`
<urlset>
  <url>
    <loc>https://example.com/search?q=crawl&amp;page=2</loc>
    <priority>0.7</priority>
  </url>
</urlset>
`, { headers: { "content-type": "application/xml" } }));

    const entries = await fetchSitemap(`${baseUrl}/sitemap.xml`);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.url).toBe("https://example.com/search?q=crawl&page=2");
    expect(entries[0]!.priority).toBe(0.7);
  });

  it("decodes XML entities in sitemap index child URLs before fetching them", async () => {
    const baseUrl = serveSitemap((url) => {
      if (url.pathname === "/sitemap.xml") {
        return new Response(`
<sitemapindex>
  <sitemap>
    <loc>${baseUrl}/child.xml?part=1&amp;lang=en</loc>
  </sitemap>
</sitemapindex>
`, { headers: { "content-type": "application/xml" } });
      }

      if (
        url.pathname === "/child.xml" &&
        url.searchParams.get("part") === "1" &&
        url.searchParams.get("lang") === "en"
      ) {
        return new Response(`
<urlset>
  <url><loc>https://example.com/from-child</loc></url>
</urlset>
`, { headers: { "content-type": "application/xml" } });
      }

      return new Response("not found", { status: 404 });
    });

    const entries = await fetchSitemap(`${baseUrl}/sitemap.xml`);

    expect(entries.map((entry) => entry.url)).toEqual(["https://example.com/from-child"]);
  });

  it("preserves entity text inside CDATA sections", async () => {
    const baseUrl = serveSitemap(() => new Response(`
<urlset>
  <url>
    <loc><![CDATA[https://example.com/search?q=crawl&amp;page=2]]></loc>
  </url>
</urlset>
`, { headers: { "content-type": "application/xml" } }));

    const entries = await fetchSitemap(`${baseUrl}/sitemap.xml`);

    expect(entries.map((entry) => entry.url)).toEqual([
      "https://example.com/search?q=crawl&amp;page=2",
    ]);
  });

  it("leaves XML-invalid numeric references unchanged", async () => {
    const baseUrl = serveSitemap(() => new Response(`
<urlset>
  <url><loc>https://example.com/null&#0;byte</loc></url>
  <url><loc>https://example.com/surrogate&#xD800;value</loc></url>
  <url><loc>https://example.com/valid&#x2F;slash</loc></url>
</urlset>
`, { headers: { "content-type": "application/xml" } }));

    const entries = await fetchSitemap(`${baseUrl}/sitemap.xml`);

    expect(entries.map((entry) => entry.url)).toEqual([
      "https://example.com/null&#0;byte",
      "https://example.com/surrogate&#xD800;value",
      "https://example.com/valid/slash",
    ]);
  });
});
