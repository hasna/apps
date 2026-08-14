import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

interface SerpApiOrganicResult {
  title: string;
  link: string;
  snippet?: string;
  date?: string;
  thumbnail?: string;
  position?: number;
}

interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  error?: string;
}

export class GoogleProvider implements SearchProvider {
  name = "google" as const;
  displayName = "Google";

  isConfigured(): boolean {
    return !!Bun.env.SERP_API_KEY;
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    const apiKey = Bun.env.SERP_API_KEY;
    if (!apiKey) throw new Error("SERP_API_KEY not configured");

    const params = new URLSearchParams({
      api_key: apiKey,
      engine: "google",
      q: query,
      num: String(options?.limit ?? 10),
    });

    if (options?.language) params.set("hl", options.language);
    if (options?.region) params.set("gl", options.region);
    if (options?.safeSearch) params.set("safe", "active");

    const res = await fetch(`https://serpapi.com/search.json?${params}`);
    if (!res.ok) throw new Error(`SerpAPI error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as SerpApiResponse;
    if (data.error) throw new Error(`SerpAPI error: ${data.error}`);

    return (data.organic_results ?? []).map((r, i) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet ?? "",
      score: 1 - i * 0.05,
      publishedAt: r.date ?? undefined,
      thumbnail: r.thumbnail ?? undefined,
      metadata: { position: r.position ?? i + 1 },
    }));
  }
}
