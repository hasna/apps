import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

interface HNHit {
  objectID: string;
  title?: string;
  url?: string;
  story_text?: string;
  comment_text?: string;
  author: string;
  points?: number;
  num_comments?: number;
  created_at: string;
  _tags?: string[];
}

interface HNResponse {
  hits: HNHit[];
  nbHits: number;
}

export class HackerNewsProvider implements SearchProvider {
  name = "hackernews" as const;
  displayName = "Hacker News";

  isConfigured(): boolean {
    return true; // No API key needed
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    const params = new URLSearchParams({
      query,
      hitsPerPage: String(options?.limit ?? 10),
      tags: "story",
    });

    if (options?.dateRange?.from) {
      params.set("numericFilters", `created_at_i>${Math.floor(new Date(options.dateRange.from).getTime() / 1000)}`);
    }

    const res = await fetch(`https://hn.algolia.com/api/v1/search?${params}`);
    if (!res.ok) throw new Error(`HN Algolia API error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as HNResponse;

    return data.hits.map((hit) => {
      const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
      return {
        title: hit.title ?? hit.comment_text?.substring(0, 100) ?? "Untitled",
        url: hit.url ?? hnUrl,
        snippet: hit.story_text?.substring(0, 300) ?? hit.comment_text?.substring(0, 300) ?? "",
        score: (hit.points ?? 0) / 100,
        publishedAt: hit.created_at,
        metadata: {
          hnUrl,
          author: hit.author,
          points: hit.points,
          comments: hit.num_comments,
          tags: hit._tags,
          totalHits: data.nbHits,
        },
      };
    });
  }
}
