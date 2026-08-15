const BASE = "/api";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// --- Search ---
export interface SearchResponse {
  search: {
    id: string;
    query: string;
    providers: string[];
    resultCount: number;
    duration: number;
    createdAt: string;
  };
  results: SearchResultItem[];
  errors: Array<{ provider: string; error: string }>;
}

export interface SearchResultItem {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  provider: string;
  rank: number;
  score: number | null;
  publishedAt: string | null;
  thumbnail: string | null;
  metadata: Record<string, unknown>;
}

export async function search(
  query: string,
  providers?: string[],
  profile?: string,
  limit?: number,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (providers?.length) params.set("providers", providers.join(","));
  if (profile) params.set("profile", profile);
  if (limit) params.set("limit", String(limit));
  return fetchJson(`/search?${params}`);
}

// --- History ---
export interface SearchHistoryResponse {
  searches: Array<{
    id: string;
    query: string;
    providers: string[];
    resultCount: number;
    duration: number;
    createdAt: string;
  }>;
  total: number;
}

export async function listSearches(limit = 20, offset = 0): Promise<SearchHistoryResponse> {
  return fetchJson(`/searches?limit=${limit}&offset=${offset}`);
}

export async function deleteSearchItem(id: string): Promise<void> {
  await fetchJson(`/searches/${id}`, { method: "DELETE" });
}

// --- Providers ---
export interface ProviderItem {
  name: string;
  enabled: boolean;
  apiKeyEnv: string;
  rateLimit: number;
  configured: boolean;
  lastUsedAt: string | null;
}

export async function listProviders(): Promise<ProviderItem[]> {
  return fetchJson("/providers");
}

export async function updateProviderApi(
  name: string,
  updates: { enabled?: boolean; rateLimit?: number },
): Promise<void> {
  await fetchJson(`/providers/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

// --- Profiles ---
export interface ProfileItem {
  id: string;
  name: string;
  description: string | null;
  providers: string[];
  createdAt: string;
}

export async function listProfiles(): Promise<ProfileItem[]> {
  return fetchJson("/profiles");
}

export async function createProfileApi(data: {
  name: string;
  providers: string[];
  description?: string;
}): Promise<ProfileItem> {
  return fetchJson("/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteProfileApi(id: string): Promise<void> {
  await fetchJson(`/profiles/${id}`, { method: "DELETE" });
}

// --- Saved searches ---
export interface SavedSearchItem {
  id: string;
  name: string;
  query: string;
  providers: string[];
  lastRunAt: string | null;
  createdAt: string;
}

export async function listSavedSearches(): Promise<SavedSearchItem[]> {
  return fetchJson("/saved-searches");
}

export async function runSavedSearch(id: string): Promise<SearchResponse> {
  return fetchJson(`/saved-searches/${id}/run`, { method: "POST" });
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await fetchJson(`/saved-searches/${id}`, { method: "DELETE" });
}

// --- Local find + index ---
export interface FindMatchItem {
  path: string;
  root: string;
  kind: "file" | "content" | "both";
  score: number;
  line?: number;
  snippet?: string;
  matches?: Array<{ line: number; text: string }>;
}

export interface FindResponseData {
  query: string;
  kind: string;
  indexed: boolean;
  roots: number;
  total: number;
  results: FindMatchItem[];
}

export interface IndexRootItem {
  id: string;
  path: string;
  name: string;
  status: "pending" | "indexing" | "ready" | "error";
  error: string | null;
  fileCount: number;
  contentIndexing: boolean;
  lastIndexedAt: string | null;
  lastDurationMs: number | null;
  staleMinutes: number | null;
}

export interface IndexStatsItem {
  rootId: string;
  added: number;
  updated: number;
  deleted: number;
  contentIndexed: number;
  fileCount: number;
  durationMs: number;
}

export async function findFiles(
  query: string,
  opts: { kind?: string; root?: string; ext?: string; dir?: string; limit?: number } = {},
): Promise<FindResponseData> {
  const params = new URLSearchParams({ q: query });
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.root) params.set("root", opts.root);
  if (opts.ext) params.set("ext", opts.ext);
  if (opts.dir) params.set("dir", opts.dir);
  if (opts.limit) params.set("limit", String(opts.limit));
  return fetchJson(`/find?${params}`);
}

export async function listIndexRoots(): Promise<IndexRootItem[]> {
  return fetchJson("/index");
}

export async function addIndexRoot(data: {
  path: string;
  name?: string;
  content?: boolean;
}): Promise<{ root: IndexRootItem; stats: IndexStatsItem }> {
  return fetchJson("/index", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateIndexRoot(ref: string): Promise<IndexStatsItem> {
  return fetchJson(`/index/${encodeURIComponent(ref)}`, { method: "PUT" });
}

export async function removeIndexRoot(ref: string): Promise<void> {
  await fetchJson(`/index/${encodeURIComponent(ref)}`, { method: "DELETE" });
}

// --- Stats ---
export interface StatsResponse {
  totalSearches: number;
  totalResults: number;
  providerBreakdown: Record<string, number>;
}

export async function getStats(): Promise<StatsResponse> {
  return fetchJson("/stats");
}
