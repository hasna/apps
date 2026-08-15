import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

interface GitHubCodeItem {
  name: string;
  path: string;
  html_url: string;
  repository: {
    full_name: string;
    description?: string;
    stargazers_count?: number;
    language?: string;
    html_url: string;
  };
  text_matches?: Array<{
    fragment: string;
  }>;
}

interface GitHubRepoItem {
  full_name: string;
  html_url: string;
  description?: string;
  stargazers_count: number;
  language?: string;
  updated_at: string;
  topics?: string[];
}

interface GitHubSearchResponse<T> {
  total_count: number;
  items: T[];
  message?: string;
}

export class GitHubProvider implements SearchProvider {
  name = "github" as const;
  displayName = "GitHub";

  isConfigured(): boolean {
    return !!Bun.env.GITHUB_TOKEN;
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    const token = Bun.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not configured");

    const limit = options?.limit ?? 10;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // Search both code and repos, merge results
    const [codeResults, repoResults] = await Promise.allSettled([
      this.searchCode(query, Math.ceil(limit / 2), headers),
      this.searchRepos(query, Math.ceil(limit / 2), headers),
    ]);

    const results: RawSearchResult[] = [];
    if (codeResults.status === "fulfilled") results.push(...codeResults.value);
    if (repoResults.status === "fulfilled") results.push(...repoResults.value);

    return results.slice(0, limit);
  }

  private async searchCode(
    query: string,
    limit: number,
    headers: Record<string, string>,
  ): Promise<RawSearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      per_page: String(limit),
    });

    const res = await fetch(`https://api.github.com/search/code?${params}`, {
      headers: {
        ...headers,
        Accept: "application/vnd.github.text-match+json",
      },
    });

    if (!res.ok) return [];

    const data = (await res.json()) as GitHubSearchResponse<GitHubCodeItem>;

    return data.items.map((item) => ({
      title: `${item.repository.full_name}/${item.path}`,
      url: item.html_url,
      snippet:
        item.text_matches?.[0]?.fragment ?? `Code match in ${item.path}`,
      score: (item.repository.stargazers_count ?? 0) / 10000,
      metadata: {
        type: "code",
        repo: item.repository.full_name,
        path: item.path,
        language: item.repository.language,
        stars: item.repository.stargazers_count,
      },
    }));
  }

  private async searchRepos(
    query: string,
    limit: number,
    headers: Record<string, string>,
  ): Promise<RawSearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      per_page: String(limit),
      sort: "stars",
      order: "desc",
    });

    const res = await fetch(`https://api.github.com/search/repositories?${params}`, {
      headers,
    });

    if (!res.ok) return [];

    const data = (await res.json()) as GitHubSearchResponse<GitHubRepoItem>;

    return data.items.map((item) => ({
      title: item.full_name,
      url: item.html_url,
      snippet: item.description ?? "",
      score: item.stargazers_count / 10000,
      publishedAt: item.updated_at,
      metadata: {
        type: "repository",
        stars: item.stargazers_count,
        language: item.language,
        topics: item.topics,
      },
    }));
  }
}
