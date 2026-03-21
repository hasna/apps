import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

interface ExaResult {
  title: string;
  url: string;
  text?: string;
  score?: number;
  publishedDate?: string;
  image?: string;
  author?: string;
}

interface ExaResponse {
  results: ExaResult[];
  autopromptString?: string;
}

export class ExaProvider implements SearchProvider {
  name = "exa" as const;
  displayName = "Exa.ai";

  isConfigured(): boolean {
    return !!Bun.env.EXA_API_KEY;
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    const apiKey = Bun.env.EXA_API_KEY;
    if (!apiKey) throw new Error("EXA_API_KEY not configured");

    const body: Record<string, unknown> = {
      query,
      numResults: options?.limit ?? 10,
      type: "auto",
      contents: {
        text: { maxCharacters: 500 },
      },
    };

    if (options?.dateRange?.from) body.startPublishedDate = options.dateRange.from;
    if (options?.dateRange?.to) body.endPublishedDate = options.dateRange.to;

    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Exa API error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as ExaResponse;

    return data.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.text ?? "",
      score: r.score,
      publishedAt: r.publishedDate ?? undefined,
      thumbnail: r.image ?? undefined,
      metadata: { author: r.author },
    }));
  }
}
