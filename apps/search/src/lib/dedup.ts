import type { SearchResult } from "../types/index.js";

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Lowercase host
    u.hostname = u.hostname.toLowerCase();
    // Remove trailing slash
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    // Sort query params
    const params = new URLSearchParams(u.search);
    const sorted = new URLSearchParams([...params.entries()].sort());
    u.search = sorted.toString();
    // Remove common tracking params
    u.searchParams.delete("utm_source");
    u.searchParams.delete("utm_medium");
    u.searchParams.delete("utm_campaign");
    u.searchParams.delete("utm_content");
    u.searchParams.delete("utm_term");
    u.searchParams.delete("ref");
    u.searchParams.delete("fbclid");
    u.searchParams.delete("gclid");
    // Remove hash
    u.hash = "";
    return u.toString();
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const groups = new Map<string, SearchResult[]>();

  for (const result of results) {
    const key = normalizeUrl(result.url);
    const existing = groups.get(key);
    if (existing) {
      existing.push(result);
    } else {
      groups.set(key, [result]);
    }
  }

  const deduped: SearchResult[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      deduped.push(group[0]!);
      continue;
    }

    // Keep the result with the highest score
    group.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const best = group[0]!;

    // Merge metadata from duplicates
    const mergedMetadata = { ...best.metadata };
    for (let i = 1; i < group.length; i++) {
      const dup = group[i]!;
      mergedMetadata[`also_found_on_${dup.source}`] = true;
      // Use longer snippet if available
      if (dup.snippet.length > best.snippet.length) {
        best.snippet = dup.snippet;
      }
    }

    best.metadata = mergedMetadata;
    deduped.push(best);
  }

  // Re-rank by score
  deduped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  deduped.forEach((r, i) => {
    r.rank = i + 1;
  });

  return deduped;
}
