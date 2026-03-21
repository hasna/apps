import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { GoogleProvider } from "./google";
import { BraveProvider } from "./brave";
import { BingProvider } from "./bing";
import { ExaProvider } from "./exa";
import { HackerNewsProvider } from "./hackernews";
import { ArxivProvider } from "./arxiv";
import { getProvider, getAllProviders, getConfiguredProviders } from "./index";

// Save original fetch
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("provider registry", () => {
  it("should return all 12 providers", () => {
    const all = getAllProviders();
    expect(all.length).toBe(12);
    const names = all.map((p) => p.name);
    expect(names).toContain("google");
    expect(names).toContain("arxiv");
    expect(names).toContain("hackernews");
    expect(names).toContain("github");
  });

  it("should get provider by name", () => {
    const p = getProvider("brave");
    expect(p.displayName).toBe("Brave Search");
  });

  it("should throw for unknown provider", () => {
    expect(() => getProvider("nonexistent" as any)).toThrow("Unknown provider");
  });
});

describe("GoogleProvider", () => {
  it("should not be configured without env var", () => {
    const orig = Bun.env.SERP_API_KEY;
    delete Bun.env.SERP_API_KEY;
    const p = new GoogleProvider();
    expect(p.isConfigured()).toBe(false);
    if (orig) Bun.env.SERP_API_KEY = orig;
  });

  it("should parse SerpAPI response", async () => {
    Bun.env.SERP_API_KEY = "test-key";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            organic_results: [
              { title: "Result 1", link: "https://r1.com", snippet: "Snippet 1", position: 1 },
              { title: "Result 2", link: "https://r2.com", snippet: "Snippet 2", position: 2 },
            ],
          }),
        ),
      ),
    ) as any;

    const p = new GoogleProvider();
    const results = await p.search("test query", { limit: 2 });
    expect(results.length).toBe(2);
    expect(results[0]!.title).toBe("Result 1");
    expect(results[0]!.url).toBe("https://r1.com");
    expect(results[0]!.snippet).toBe("Snippet 1");
  });
});

describe("BraveProvider", () => {
  it("should parse Brave response", async () => {
    Bun.env.BRAVE_API_KEY = "test-key";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            web: {
              results: [
                { title: "Brave Result", url: "https://brave.com", description: "A brave result" },
              ],
            },
          }),
        ),
      ),
    ) as any;

    const p = new BraveProvider();
    const results = await p.search("test");
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Brave Result");
  });
});

describe("BingProvider", () => {
  it("should parse Bing response", async () => {
    Bun.env.BING_API_KEY = "test-key";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            webPages: {
              value: [
                { name: "Bing Result", url: "https://bing.com/r", snippet: "Bing snippet" },
              ],
              totalEstimatedMatches: 100,
            },
          }),
        ),
      ),
    ) as any;

    const p = new BingProvider();
    const results = await p.search("test");
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Bing Result");
  });
});

describe("ExaProvider", () => {
  it("should parse Exa response", async () => {
    Bun.env.EXA_API_KEY = "test-key";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              { title: "Exa Result", url: "https://exa.ai/r", text: "Exa text", score: 0.95 },
            ],
          }),
        ),
      ),
    ) as any;

    const p = new ExaProvider();
    const results = await p.search("test");
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBe(0.95);
  });
});

describe("HackerNewsProvider", () => {
  it("should always be configured", () => {
    const p = new HackerNewsProvider();
    expect(p.isConfigured()).toBe(true);
  });

  it("should parse Algolia HN response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            hits: [
              {
                objectID: "123",
                title: "Show HN: My Project",
                url: "https://myproject.com",
                author: "user1",
                points: 150,
                num_comments: 42,
                created_at: "2024-01-01T00:00:00Z",
              },
            ],
            nbHits: 1,
          }),
        ),
      ),
    ) as any;

    const p = new HackerNewsProvider();
    const results = await p.search("project");
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Show HN: My Project");
    expect(results[0]!.metadata.points).toBe(150);
  });
});

describe("ArxivProvider", () => {
  it("should always be configured", () => {
    const p = new ArxivProvider();
    expect(p.isConfigured()).toBe(true);
  });

  it("should parse Atom XML response", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>Test Paper Title</title>
    <summary>This is the abstract of the paper.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <author><name>John Doe</name></author>
    <author><name>Jane Smith</name></author>
    <category term="cs.AI"/>
    <link href="http://arxiv.org/pdf/2401.00001v1" title="pdf"/>
  </entry>
</feed>`;

    globalThis.fetch = mock(() => Promise.resolve(new Response(xml))) as any;

    const p = new ArxivProvider();
    const results = await p.search("test");
    expect(results.length).toBe(1);
    expect(results[0]!.title).toBe("Test Paper Title");
    expect((results[0]!.metadata.authors as string[]).length).toBe(2);
    expect((results[0]!.metadata.categories as string[])).toContain("cs.AI");
  });
});
