import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
  age?: string;
  thumbnail?: { src: string };
}

interface BraveResponse {
  web?: {
    results: BraveWebResult[];
  };
}

export class BraveProvider implements SearchProvider {
  name = "brave" as const;
  displayName = "Brave Search";

  isConfigured(): boolean {
    return !!Bun.env.BRAVE_API_KEY;
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    const apiKey = Bun.env.BRAVE_API_KEY;
    if (!apiKey) throw new Error("BRAVE_API_KEY not configured");

    const params = new URLSearchParams({
      q: query,
      count: String(options?.limit ?? 10),
    });

    if (options?.safeSearch) params.set("safesearch", "strict");
    if (options?.language) params.set("search_lang", options.language);
    if (options?.region) params.set("country", options.region);

    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!res.ok) throw new Error(`Brave Search API error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as BraveResponse;

    return (data.web?.results ?? []).map((r, i) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? "",
      score: 1 - i * 0.05,
      publishedAt: r.age ?? undefined,
      thumbnail: r.thumbnail?.src ?? undefined,
      metadata: {},
    }));
  }
}
