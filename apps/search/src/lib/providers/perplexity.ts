import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

interface PerplexityCitation {
  url: string;
  title?: string;
  snippet?: string;
}

interface PerplexityResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  citations?: string[] | PerplexityCitation[];
}

export class PerplexityProvider implements SearchProvider {
  name = "perplexity" as const;
  displayName = "Perplexity";

  isConfigured(): boolean {
    return !!Bun.env.PERPLEXITY_API_KEY;
  }

  async search(query: string, _options?: SearchOptions): Promise<RawSearchResult[]> {
    const apiKey = Bun.env.PERPLEXITY_API_KEY;
    if (!apiKey) throw new Error("PERPLEXITY_API_KEY not configured");

    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are a search assistant. Provide factual, well-sourced answers with citations.",
          },
          { role: "user", content: query },
        ],
        return_citations: true,
      }),
    });

    if (!res.ok) throw new Error(`Perplexity API error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as PerplexityResponse;
    const content = data.choices[0]?.message?.content ?? "";
    const citations = data.citations ?? [];

    return citations.map((citation, i) => {
      const isString = typeof citation === "string";
      const url = isString ? citation : citation.url;
      const title = isString ? url : (citation.title ?? url);
      const snippet = isString ? content.substring(0, 300) : (citation.snippet ?? content.substring(0, 300));

      return {
        title,
        url,
        snippet,
        score: 1 - i * 0.1,
        metadata: { aiSummary: content.substring(0, 500) },
      };
    });
  }
}
