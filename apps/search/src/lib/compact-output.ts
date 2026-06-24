import type {
  ProviderConfig,
  SavedSearch,
  Search,
  SearchProfile,
  SearchResult,
} from "../types/index.js";

export const DEFAULT_COMPACT_LIMIT = 20;
export const MAX_COMPACT_LIMIT = 100;
export const DEFAULT_TEXT_LIMIT = 96;
export const DEFAULT_SNIPPET_LIMIT = 160;

export function clampLimit(value: unknown, fallback = DEFAULT_COMPACT_LIMIT): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, MAX_COMPACT_LIMIT);
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateText(value: string | null | undefined, max = DEFAULT_TEXT_LIMIT): string {
  const text = collapseWhitespace(value ?? "");
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

export function truncateMiddle(value: string | null | undefined, max = DEFAULT_TEXT_LIMIT): string {
  const text = collapseWhitespace(value ?? "");
  if (text.length <= max) return text;
  if (max < 8) return truncateText(text, max);
  const head = Math.ceil((max - 3) / 2);
  const tail = Math.floor((max - 3) / 2);
  return `${text.slice(0, head)}...${text.slice(text.length - tail)}`;
}

export function compactSearch(search: Search): Record<string, unknown> {
  return {
    id: search.id,
    query: truncateText(search.query),
    providers: search.providers,
    resultCount: search.resultCount,
    duration: search.duration,
    createdAt: search.createdAt,
  };
}

export function compactResult(result: SearchResult): Record<string, unknown> {
  return {
    id: result.id,
    rank: result.rank,
    source: result.source,
    title: truncateText(result.title),
    url: truncateMiddle(result.url, 120),
    snippet: truncateText(result.snippet, DEFAULT_SNIPPET_LIMIT),
    score: result.score,
  };
}

export function compactSavedSearch(saved: SavedSearch): Record<string, unknown> {
  return {
    id: saved.id,
    name: truncateText(saved.name, 64),
    query: truncateText(saved.query),
    providers: saved.providers,
    lastRunAt: saved.lastRunAt,
    createdAt: saved.createdAt,
  };
}

export function compactProvider(
  provider: ProviderConfig,
  configured: boolean,
): Record<string, unknown> {
  return {
    name: provider.name,
    enabled: provider.enabled,
    configured,
    apiKeyEnv: provider.apiKeyEnv || null,
    rateLimit: provider.rateLimit,
    lastUsedAt: provider.lastUsedAt,
  };
}

export function compactProfile(profile: SearchProfile): Record<string, unknown> {
  return {
    id: profile.id,
    name: profile.name,
    providers: profile.providers,
    description: profile.description ? truncateText(profile.description) : null,
    createdAt: profile.createdAt,
  };
}

export function compactEnvelope<T>(
  kind: string,
  items: T[],
  opts: {
    total?: number;
    limit?: number;
    offset?: number;
    hint?: string;
  } = {},
): Record<string, unknown> {
  const offset = opts.offset ?? 0;
  const total = opts.total ?? items.length;
  const nextOffset = offset + items.length;
  return {
    kind,
    total,
    returned: items.length,
    offset,
    ...(nextOffset < total ? { nextOffset } : {}),
    items,
    ...(opts.hint ? { hint: opts.hint } : {}),
  };
}
