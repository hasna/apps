import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

interface YouTubeSearchItem {
  id: { videoId?: string };
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    channelTitle: string;
    thumbnails?: {
      medium?: { url: string };
      high?: { url: string };
    };
  };
}

interface YouTubeResponse {
  items?: YouTubeSearchItem[];
  error?: { message: string };
  pageInfo?: { totalResults: number };
}

export class YouTubeProvider implements SearchProvider {
  name = "youtube" as const;
  displayName = "YouTube";

  isConfigured(): boolean {
    return !!Bun.env.YOUTUBE_API_KEY;
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    const apiKey = Bun.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error("YOUTUBE_API_KEY not configured");

    const params = new URLSearchParams({
      part: "snippet",
      q: query,
      type: "video",
      maxResults: String(options?.limit ?? 10),
      key: apiKey,
      order: "relevance",
    });

    if (options?.language) params.set("relevanceLanguage", options.language);
    if (options?.safeSearch) params.set("safeSearch", "strict");
    if (options?.dateRange?.from) params.set("publishedAfter", new Date(options.dateRange.from).toISOString());
    if (options?.dateRange?.to) params.set("publishedBefore", new Date(options.dateRange.to).toISOString());

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${params}`,
    );

    if (!res.ok) throw new Error(`YouTube API error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as YouTubeResponse;
    if (data.error) throw new Error(`YouTube API error: ${data.error.message}`);

    return (data.items ?? [])
      .filter((item) => item.id.videoId)
      .map((item, i) => ({
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        snippet: item.snippet.description,
        score: 1 - i * 0.05,
        publishedAt: item.snippet.publishedAt,
        thumbnail:
          item.snippet.thumbnails?.high?.url ??
          item.snippet.thumbnails?.medium?.url ??
          undefined,
        metadata: {
          videoId: item.id.videoId,
          channelTitle: item.snippet.channelTitle,
          totalResults: data.pageInfo?.totalResults,
        },
      }));
  }
}
