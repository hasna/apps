import { z } from "zod";

// --- Provider Names ---

export const PROVIDER_NAMES = [
  "google",
  "serpapi",
  "exa",
  "perplexity",
  "brave",
  "bing",
  "twitter",
  "reddit",
  "youtube",
  "hackernews",
  "github",
  "arxiv",
] as const;

export type SearchProviderName = (typeof PROVIDER_NAMES)[number];

export const SearchProviderNameSchema = z.enum(PROVIDER_NAMES);

// --- Export Formats ---

export const EXPORT_FORMATS = ["json", "csv", "md"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const ExportFormatSchema = z.enum(EXPORT_FORMATS);

// --- Search Options ---

export interface SearchOptions {
  limit?: number;
  offset?: number;
  dateRange?: { from?: string; to?: string };
  language?: string;
  region?: string;
  safeSearch?: boolean;
}

export const SearchOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  dateRange: z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .optional(),
  language: z.string().optional(),
  region: z.string().optional(),
  safeSearch: z.boolean().optional(),
});

// --- Search Result ---

export interface SearchResult {
  id: string;
  searchId: string;
  title: string;
  url: string;
  snippet: string;
  source: SearchProviderName;
  provider: string;
  rank: number;
  score: number | null;
  publishedAt: string | null;
  thumbnail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// --- Search Record (History) ---

export interface Search {
  id: string;
  query: string;
  providers: SearchProviderName[];
  profileId: string | null;
  resultCount: number;
  duration: number;
  createdAt: string;
}

// --- Saved Search ---

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  providers: SearchProviderName[];
  profileId: string | null;
  options: SearchOptions;
  createdAt: string;
  lastRunAt: string | null;
}

// --- Provider Config ---

export interface ProviderConfig {
  name: SearchProviderName;
  enabled: boolean;
  apiKeyEnv: string;
  rateLimit: number;
  lastUsedAt: string | null;
  metadata: Record<string, unknown>;
}

// --- Search Profile ---

export interface SearchProfile {
  id: string;
  name: string;
  description: string | null;
  providers: SearchProviderName[];
  options: SearchOptions;
  createdAt: string;
}

// --- Config ---

export interface SearchConfig {
  defaultLimit: number;
  defaultProviders: SearchProviderName[];
  defaultProfile: string | null;
  transcriber: {
    baseUrl: string;
    fallbackCli: string;
  };
  dedup: boolean;
  maxConcurrent: number;
}

export const DEFAULT_CONFIG: SearchConfig = {
  defaultLimit: 10,
  defaultProviders: [],
  defaultProfile: null,
  transcriber: {
    baseUrl: "http://localhost:19600",
    fallbackCli: "microservice-transcriber",
  },
  dedup: true,
  maxConcurrent: 5,
};

// --- Unified Search Response ---

export interface UnifiedSearchResponse {
  search: Search;
  results: SearchResult[];
  errors: Array<{ provider: SearchProviderName; error: string }>;
}

// --- ID generation ---

let counter = 0;

export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  counter = (counter + 1) % 1000;
  return `${timestamp}-${random}-${counter.toString(36)}`;
}

// --- Custom Errors ---

export class SearchError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = "SearchError";
  }
}

export class ProviderError extends SearchError {
  constructor(
    public provider: SearchProviderName,
    message: string,
  ) {
    super(message, "PROVIDER_ERROR", 502);
    this.name = "ProviderError";
  }
}

export class NotFoundError extends SearchError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends SearchError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 422);
    this.name = "ValidationError";
  }
}
