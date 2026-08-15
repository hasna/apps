import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

interface Tweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    impression_count?: number;
  };
}

interface TwitterUser {
  id: string;
  name: string;
  username: string;
}

interface TwitterResponse {
  data?: Tweet[];
  includes?: { users?: TwitterUser[] };
  errors?: Array<{ message: string }>;
}

export class TwitterProvider implements SearchProvider {
  name = "twitter" as const;
  displayName = "X / Twitter";

  isConfigured(): boolean {
    return !!Bun.env.X_BEARER_TOKEN;
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    const token = Bun.env.X_BEARER_TOKEN;
    if (!token) throw new Error("X_BEARER_TOKEN not configured");

    const params = new URLSearchParams({
      query,
      max_results: String(Math.min(options?.limit ?? 10, 100)),
      "tweet.fields": "created_at,public_metrics,author_id",
      expansions: "author_id",
      "user.fields": "name,username",
    });

    if (options?.dateRange?.from) params.set("start_time", new Date(options.dateRange.from).toISOString());
    if (options?.dateRange?.to) params.set("end_time", new Date(options.dateRange.to).toISOString());

    const res = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!res.ok) throw new Error(`Twitter API error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as TwitterResponse;
    if (data.errors?.length) throw new Error(`Twitter API error: ${data.errors[0]!.message}`);

    const users = new Map<string, TwitterUser>();
    for (const u of data.includes?.users ?? []) {
      users.set(u.id, u);
    }

    return (data.data ?? []).map((tweet, i) => {
      const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
      const username = user?.username ?? "unknown";

      return {
        title: tweet.text.substring(0, 100) + (tweet.text.length > 100 ? "..." : ""),
        url: `https://x.com/${username}/status/${tweet.id}`,
        snippet: tweet.text,
        score: tweet.public_metrics
          ? (tweet.public_metrics.like_count + tweet.public_metrics.retweet_count * 2) / 1000
          : 1 - i * 0.05,
        publishedAt: tweet.created_at,
        metadata: {
          authorName: user?.name,
          authorUsername: username,
          metrics: tweet.public_metrics,
        },
      };
    });
  }
}
