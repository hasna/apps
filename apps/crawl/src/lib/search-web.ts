import type { Page } from "../types/index.js";
import { requireExaApiKey, type ExaAuthOptions } from "./exa.js";

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedDate?: string;
  page?: Page;
}

export async function searchWeb(
  query: string,
  options?: { limit?: number; scrape?: boolean; category?: string } & ExaAuthOptions
): Promise<WebSearchResult[]> {
  const apiKey = requireExaApiKey(options);

  const body: Record<string, unknown> = {
    query,
    numResults: options?.limit ?? 10,
    contents: { text: { maxCharacters: 500 } },
  };
  if (options?.category) body.category = options.category;

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Exa API error: ${res.status} ${res.statusText}`);
  const data = await res.json() as { results?: Array<{ url: string; title?: string; text?: string; publishedDate?: string }> };

  const results: WebSearchResult[] = (data.results ?? []).map(r => ({
    url: r.url,
    title: r.title ?? r.url,
    snippet: r.text?.slice(0, 300) ?? "",
    publishedDate: r.publishedDate,
  }));

  if (options?.scrape && results.length > 0) {
    const { crawlUrl } = await import("./crawler.js");
    const { createCrawl } = await import("../db/crawls.js");
    const crawl = createCrawl({ url: results[0]!.url, maxPages: results.length });
    await Promise.allSettled(
      results.map(async (r) => {
        try {
          const page = await crawlUrl(r.url, crawl.id);
          r.page = page;
        } catch { /* skip */ }
      })
    );
  }

  return results;
}
