import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

interface BingWebPage {
  name: string;
  url: string;
  snippet?: string;
  dateLastCrawled?: string;
  thumbnailUrl?: string;
}

interface BingResponse {
  webPages?: {
    value: BingWebPage[];
    totalEstimatedMatches?: number;
  };
  error?: { message: string };
}

export class BingProvider implements SearchProvider {
  name = "bing" as const;
  displayName = "Bing";

  isConfigured(): boolean {
    return !!Bun.env.BING_API_KEY;
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    const apiKey = Bun.env.BING_API_KEY;
    if (!apiKey) throw new Error("BING_API_KEY not configured");

    const params = new URLSearchParams({
      q: query,
      count: String(options?.limit ?? 10),
      responseFilter: "Webpages",
    });

    if (options?.offset) params.set("offset", String(options.offset));
    if (options?.safeSearch) params.set("safeSearch", "Strict");
    if (options?.region) params.set("mkt", options.region);

    const res = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?${params}`,
      {
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
        },
      },
    );

    if (!res.ok) throw new Error(`Bing API error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as BingResponse;
    if (data.error) throw new Error(`Bing API error: ${data.error.message}`);

    return (data.webPages?.value ?? []).map((r, i) => ({
      title: r.name,
      url: r.url,
      snippet: r.snippet ?? "",
      score: 1 - i * 0.05,
      publishedAt: r.dateLastCrawled ?? undefined,
      thumbnail: r.thumbnailUrl ?? undefined,
      metadata: {
        totalEstimatedMatches: data.webPages?.totalEstimatedMatches,
      },
    }));
  }
}
