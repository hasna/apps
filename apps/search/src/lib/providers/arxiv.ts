import type { SearchOptions } from "../../types/index.js";
import type { SearchProvider, RawSearchResult } from "./types.js";

export class ArxivProvider implements SearchProvider {
  name = "arxiv" as const;
  displayName = "arXiv";

  isConfigured(): boolean {
    return true; // No API key needed
  }

  async search(query: string, options?: SearchOptions): Promise<RawSearchResult[]> {
    const limit = options?.limit ?? 10;
    const offset = options?.offset ?? 0;

    const params = new URLSearchParams({
      search_query: `all:${query}`,
      start: String(offset),
      max_results: String(limit),
      sortBy: "relevance",
      sortOrder: "descending",
    });

    const res = await fetch(`https://export.arxiv.org/api/query?${params}`);
    if (!res.ok) throw new Error(`arXiv API error: ${res.status} ${res.statusText}`);

    const xml = await res.text();
    return this.parseAtomFeed(xml);
  }

  private parseAtomFeed(xml: string): RawSearchResult[] {
    const results: RawSearchResult[] = [];
    const entries = xml.split("<entry>");

    // Skip the first split part (feed header)
    for (let i = 1; i < entries.length; i++) {
      const entry = entries[i]!;
      const title = this.extractTag(entry, "title")?.replace(/\s+/g, " ").trim() ?? "Untitled";
      const summary = this.extractTag(entry, "summary")?.replace(/\s+/g, " ").trim() ?? "";
      const published = this.extractTag(entry, "published") ?? undefined;

      // Extract the abstract page URL (not PDF)
      const idUrl = this.extractTag(entry, "id") ?? "";

      // Extract authors
      const authors: string[] = [];
      const authorMatches = entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g);
      for (const match of authorMatches) {
        if (match[1]) authors.push(match[1].trim());
      }

      // Extract categories
      const categories: string[] = [];
      const catMatches = entry.matchAll(/category[^>]*term="([^"]+)"/g);
      for (const match of catMatches) {
        if (match[1]) categories.push(match[1]);
      }

      // Extract PDF link
      const pdfMatch = entry.match(/link[^>]*href="([^"]+)"[^>]*title="pdf"/);
      const pdfUrl = pdfMatch?.[1];

      results.push({
        title,
        url: idUrl,
        snippet: summary.substring(0, 400),
        score: 1 - (i - 1) * 0.05,
        publishedAt: published,
        metadata: {
          authors,
          categories,
          pdfUrl,
          abstract: summary,
        },
      });
    }

    return results;
  }

  private extractTag(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
    const match = xml.match(regex);
    return match?.[1] ?? null;
  }
}
