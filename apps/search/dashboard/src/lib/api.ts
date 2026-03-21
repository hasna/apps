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

// --- Stats ---
export interface StatsResponse {
  totalSearches: number;
  totalResults: number;
  providerBreakdown: Record<string, number>;
}

export async function getStats(): Promise<StatsResponse> {
  return fetchJson("/stats");
}
