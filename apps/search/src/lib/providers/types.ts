import type { SearchProviderName, SearchOptions } from "../../types/index.js";

export interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  publishedAt?: string;
  thumbnail?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchProvider {
  name: SearchProviderName;
  displayName: string;
  search(query: string, options?: SearchOptions): Promise<RawSearchResult[]>;
  isConfigured(): boolean;
}
