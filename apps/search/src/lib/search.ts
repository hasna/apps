import type { Database } from "bun:sqlite";
import {
  type SearchProviderName,
  type SearchOptions,
  type SearchResult,
  type UnifiedSearchResponse,
  generateId,
} from "../types/index.js";
import { getProvider } from "./providers/index.js";
import { deduplicateResults } from "./dedup.js";
import { getConfig } from "./config.js";
import { createSearch, updateSearchResults } from "../db/searches.js";
import { createResults } from "../db/results.js";
import { getProfileByName } from "../db/profiles.js";
import { listProviders as listDbProviders, updateProviderLastUsed } from "../db/providers.js";

export async function unifiedSearch(
  query: string,
  opts: {
    providers?: SearchProviderName[];
    profile?: string;
    options?: SearchOptions;
    dedup?: boolean;
    db?: Database;
  } = {},
): Promise<UnifiedSearchResponse> {
  const config = getConfig();
  const startTime = Date.now();
  const db = opts.db;

  // Resolve which providers to use
  let providerNames = opts.providers ?? [];

  // If a profile is specified, use its providers
  if (opts.profile) {
    const profile = getProfileByName(opts.profile, db);
    if (profile) {
      providerNames = profile.providers;
    }
  }

  // If still empty, use config defaults or all enabled
  if (providerNames.length === 0) {
    if (config.defaultProviders.length > 0) {
      providerNames = config.defaultProviders;
    } else {
      // Use all enabled providers that are configured
      const dbProviders = listDbProviders(db);
      providerNames = dbProviders
        .filter((p) => p.enabled)
        .map((p) => p.name);
    }
  }

  // Filter to only configured providers
  const activeProviders = providerNames.filter((name) => {
    try {
      const provider = getProvider(name);
      return provider.isConfigured();
    } catch {
      return false;
    }
  });

  const searchOptions: SearchOptions = {
    limit: config.defaultLimit,
    ...opts.options,
  };

  // Query all providers concurrently
  const results = await Promise.allSettled(
    activeProviders.map(async (name) => {
      const provider = getProvider(name);
      const rawResults = await provider.search(query, searchOptions);
      updateProviderLastUsed(name, db);
      return { name, results: rawResults };
    }),
  );

  // Collect results and errors
  const allResults: SearchResult[] = [];
  const errors: Array<{ provider: SearchProviderName; error: string }> = [];
  const searchId = generateId();

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { name, results: rawResults } = result.value;
      const provider = getProvider(name);

      for (let i = 0; i < rawResults.length; i++) {
        const raw = rawResults[i]!;
        allResults.push({
          id: generateId(),
          searchId,
          title: raw.title,
          url: raw.url,
          snippet: raw.snippet,
          source: name,
          provider: provider.displayName,
          rank: i + 1,
          score: raw.score ?? null,
          publishedAt: raw.publishedAt ?? null,
          thumbnail: raw.thumbnail ?? null,
          metadata: raw.metadata ?? {},
          createdAt: new Date().toISOString(),
        });
      }
    } else {
      const providerName = activeProviders[results.indexOf(result)]!;
      errors.push({
        provider: providerName,
        error: result.reason?.message ?? "Unknown error",
      });
    }
  }

  // Dedup if enabled
  const shouldDedup = opts.dedup ?? config.dedup;
  const finalResults = shouldDedup ? deduplicateResults(allResults) : allResults;

  // Re-rank if not deduped (dedup already re-ranks)
  if (!shouldDedup) {
    finalResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    finalResults.forEach((r, i) => {
      r.rank = i + 1;
    });
  }

  const duration = Date.now() - startTime;

  // Store in DB
  const search = createSearch(
    {
      query,
      providers: activeProviders,
      resultCount: finalResults.length,
      duration,
    },
    db,
  );

  // Override the generated ID with our searchId
  if (finalResults.length > 0) {
    const resultsToStore = finalResults.map((r) => ({
      ...r,
      searchId: search.id,
    }));
    createResults(
      resultsToStore.map((r) => ({
        searchId: r.searchId,
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
        provider: r.provider,
        rank: r.rank,
        score: r.score,
        publishedAt: r.publishedAt,
        thumbnail: r.thumbnail,
        metadata: r.metadata,
      })),
      db,
    );
  }

  updateSearchResults(search.id, finalResults.length, duration, db);

  return {
    search: { ...search, resultCount: finalResults.length, duration },
    results: finalResults,
    errors,
  };
}

export async function searchSingleProvider(
  provider: SearchProviderName,
  query: string,
  options?: SearchOptions,
  db?: Database,
): Promise<UnifiedSearchResponse> {
  return unifiedSearch(query, {
    providers: [provider],
    options,
    dedup: false,
    db,
  });
}
