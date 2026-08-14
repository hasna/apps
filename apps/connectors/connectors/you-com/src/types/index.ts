// You.com API Types

// ============================================
// Configuration
// ============================================

export interface YouComConfig {
  apiKey: string;
  searchBaseUrl?: string;
  researchBaseUrl?: string;
}

// ============================================
// Search API
// ============================================

export type SafeSearch = 'off' | 'moderate' | 'strict';
export type LiveCrawl = 'web' | 'news' | 'all';
export type LiveCrawlFormat = 'html' | 'markdown';
export type Freshness = 'day' | 'week' | 'month' | 'year' | string;

export interface SearchGetParams {
  query: string;
  count?: number;
  freshness?: Freshness;
  offset?: number;
  country?: string;
  language?: string;
  safesearch?: SafeSearch;
  livecrawl?: LiveCrawl;
  livecrawl_formats?: LiveCrawlFormat | LiveCrawlFormat[];
  include_domains?: string;
  exclude_domains?: string;
  boost_domains?: string;
  crawl_timeout?: number;
}

export interface SearchPostBody {
  query: string;
  count?: number;
  freshness?: Freshness;
  offset?: number;
  country?: string;
  language?: string;
  safesearch?: SafeSearch;
  livecrawl?: LiveCrawl;
  livecrawl_formats?: LiveCrawlFormat[];
  include_domains?: string[];
  exclude_domains?: string[];
  boost_domains?: string[];
  crawl_timeout?: number;
}

export interface SearchResultItem {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
  [key: string]: unknown;
}

export interface SearchResponse {
  results?: {
    web?: SearchResultItem[];
    news?: SearchResultItem[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ============================================
// Research API
// ============================================

export type ResearchEffort = 'lite' | 'standard' | 'deep' | 'exhaustive';

export interface ResearchCreateOptions {
  input: string;
  research_effort?: ResearchEffort;
  source_control?: {
    freshness?: Freshness;
    [key: string]: unknown;
  };
  output_schema?: Record<string, unknown>;
}

export interface ResearchResponse {
  output?: {
    content?: string;
    [key: string]: unknown;
  };
  citations?: Array<{ url?: string; title?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export class YouComApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'YouComApiError';
    this.statusCode = statusCode;
  }
}
