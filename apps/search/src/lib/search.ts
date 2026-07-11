import type { Database } from "bun:sqlite";
import {
  type SearchProviderName,
  type SearchOptions,
  type SearchResult,
  type UnifiedSearchResponse,
  LOCAL_PROVIDER_NAMES,
  generateId,
} from "../types/index.js";
import { getProvider } from "./providers/index.js";
import { deduplicateResults } from "./dedup.js";
import { getConfig } from "./config.js";
import { createSearch, updateSearchResults } from "../db/searches.js";
import { createResults } from "../db/results.js";
import { getProfileByName } from "../db/profiles.js";
import { listProviders as listDbProviders, updateProviderLastUsed } from "../db/providers.js";
import { routeSearchProviders } from "./router.js";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function allSettledLimited<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      const item = items[index]!;
      try {
        results[index] = { status: "fulfilled", value: await task(item) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function unifiedSearch(
  query: string,
  opts: {
    providers?: SearchProviderName[];
    profile?: string;
    options?: SearchOptions;
    dedup?: boolean;
    smart?: boolean;
    db?: Database;
  } = {},
): Promise<UnifiedSearchResponse> {
  const config = getConfig();
  const startTime = Date.now();
  const db = opts.db;

  // Resolve which providers to use
  let providerNames = opts.providers ?? [];
  const smartProfile = opts.profile === "smart";

  // If a profile is specified, use its providers
  if (opts.profile && !smartProfile) {
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

  // Filter to only configured providers; report what was dropped so a
  // request for e.g. ["files"] with no index roots fails visibly.
  const errors: Array<{ provider: SearchProviderName; error: string }> = [];
  const explicitRequest = (opts.providers?.length ?? 0) > 0 || Boolean(opts.profile);
  const routingRequested = opts.smart === true || smartProfile || (!explicitRequest && config.router.enabled);
  const reportDroppedProviders = explicitRequest || routingRequested;
  const dbProviderMap = new Map(listDbProviders(db).map((provider) => [provider.name, provider]));
  let activeProviders = providerNames.filter((name) => {
    try {
      const dbProvider = dbProviderMap.get(name);
      if (dbProvider && !dbProvider.enabled) {
        if (reportDroppedProviders) {
          errors.push({
            provider: name,
            error: "provider disabled — enable it before searching",
          });
        }
        return false;
      }
      if (getProvider(name).isConfigured()) return true;
      if (reportDroppedProviders) {
        errors.push({
          provider: name,
          error: LOCAL_PROVIDER_NAMES.has(name)
            ? "no index roots ready — run `search index add <path>` first"
            : "not configured (missing API key)",
        });
      }
      return false;
    } catch (err) {
      if (reportDroppedProviders) {
        errors.push({
          provider: name,
          error: err instanceof Error ? err.message : "unknown provider",
        });
      }
      return false;
    }
  });
  let routing: UnifiedSearchResponse["routing"];
  if (routingRequested && activeProviders.length > 0) {
    routing = await routeSearchProviders(query, activeProviders, {
      maxProviders: config.router.maxProviders,
      timeoutMs: config.router.timeoutMs,
      model: config.router.model,
    });
    activeProviders = routing.selectedProviders;
  }

  const searchOptions: SearchOptions = {
    limit: config.defaultLimit,
    ...opts.options,
  };

  // Query providers with bounded concurrency and a per-provider timeout.
  const results = await allSettledLimited(
    activeProviders,
    config.maxConcurrent,
    async (name) => {
      const provider = getProvider(name);
      const rawResults = await withTimeout(
        provider.search(query, searchOptions),
        config.providerTimeoutMs,
        provider.displayName,
      );
      updateProviderLastUsed(name, db);
      return { name, results: rawResults };
    },
  );

  // Collect results and errors
  const allResults: SearchResult[] = [];
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

  // No provider actually ran: return without polluting history.
  if (activeProviders.length === 0) {
    return {
      search: {
        id: searchId,
        query,
        providers: [],
        profileId: null,
        resultCount: 0,
        duration,
        createdAt: new Date().toISOString(),
      },
      results: finalResults,
      errors,
      ...(routing && { routing }),
    };
  }

  // Local results are reproducible from the index and machine-specific —
  // keep them out of (potentially synced) history unless explicitly enabled.
  // The stored resultCount matches what is actually persisted so history
  // stays self-consistent.
  const persistable = config.recordLocalResults
    ? finalResults
    : finalResults.filter((r) => !LOCAL_PROVIDER_NAMES.has(r.source));

  const search = createSearch(
    {
      id: searchId,
      query,
      providers: activeProviders,
      resultCount: persistable.length,
      duration,
    },
    db,
  );

  if (persistable.length > 0) {
    createResults(
      persistable.map((r) => ({
        searchId: search.id,
        id: r.id,
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

  updateSearchResults(search.id, persistable.length, duration, db);

  return {
    search: { ...search, resultCount: finalResults.length, duration },
    results: finalResults,
    errors,
    ...(routing && { routing }),
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
