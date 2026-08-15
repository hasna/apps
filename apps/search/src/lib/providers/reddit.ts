import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

interface RedditPost {
  data: {
    id: string;
    title: string;
    url: string;
    selftext?: string;
    subreddit: string;
    score: number;
    num_comments: number;
    created_utc: number;
    permalink: string;
    thumbnail?: string;
    author: string;
  };
}

interface RedditResponse {
  data?: {
    children: RedditPost[];
  };
  error?: number;
  message?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getOAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const clientId = Bun.env.REDDIT_CLIENT_ID;
  const clientSecret = Bun.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET required");

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "open-search/0.0.1",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) throw new Error(`Reddit OAuth error: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
  };
  return cachedToken.token;
}

export class RedditProvider implements SearchProvider {
  name = "reddit" as const;
  displayName = "Reddit";

  isConfigured(): boolean {
    return !!Bun.env.REDDIT_CLIENT_ID && !!Bun.env.REDDIT_CLIENT_SECRET;
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    const token = await getOAuthToken();

    const params = new URLSearchParams({
      q: query,
      limit: String(options?.limit ?? 10),
      sort: "relevance",
      type: "link",
    });

    const res = await fetch(`https://oauth.reddit.com/search?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "open-search/0.0.1",
      },
    });

    if (!res.ok) throw new Error(`Reddit API error: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as RedditResponse;
    if (data.error) throw new Error(`Reddit API error: ${data.message ?? data.error}`);

    return (data.data?.children ?? []).map((post) => {
      const p = post.data;
      return {
        title: p.title,
        url: `https://www.reddit.com${p.permalink}`,
        snippet: p.selftext?.substring(0, 300) ?? "",
        score: p.score / 1000,
        publishedAt: new Date(p.created_utc * 1000).toISOString(),
        thumbnail: p.thumbnail && p.thumbnail !== "self" ? p.thumbnail : undefined,
        metadata: {
          subreddit: p.subreddit,
          upvotes: p.score,
          comments: p.num_comments,
          author: p.author,
          originalUrl: p.url,
        },
      };
    });
  }
}
