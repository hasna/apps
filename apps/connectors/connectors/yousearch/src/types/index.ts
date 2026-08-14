// You.com Search API Types

// ============================================
// Configuration
// ============================================

export interface YouSearchConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Search
// ============================================

export type Freshness = 'day' | 'week' | 'month' | 'year';

export type SafeSearch = 'off' | 'moderate' | 'strict';

export type LiveCrawl = 'web' | 'news' | 'all';

export type LiveCrawlFormat = 'html' | 'markdown';

export type CountryCode =
  | 'AR' | 'AU' | 'AT' | 'BE' | 'BR' | 'CA' | 'CL' | 'DK' | 'FI' | 'FR'
  | 'DE' | 'HK' | 'IN' | 'ID' | 'IT' | 'JP' | 'KR' | 'MY' | 'MX' | 'NL'
  | 'NZ' | 'NO' | 'CN' | 'PL' | 'PT' | 'PH' | 'RU' | 'SA' | 'ZA' | 'ES'
  | 'SE' | 'CH' | 'TW' | 'TR' | 'GB' | 'US';

export interface SearchGetOptions {
  query: string;
  count?: number;
  freshness?: Freshness | string;
  offset?: number;
  country?: CountryCode;
  language?: string;
  safesearch?: SafeSearch;
  livecrawl?: LiveCrawl;
  livecrawl_formats?: LiveCrawlFormat | LiveCrawlFormat[];
  include_domains?: string | string[];
  exclude_domains?: string | string[];
  boost_domains?: string | string[];
  crawl_timeout?: number;
}

export interface SearchPostOptions extends Omit<SearchGetOptions, 'include_domains' | 'exclude_domains' | 'boost_domains' | 'livecrawl_formats'> {
  include_domains?: string[];
  exclude_domains?: string[];
  boost_domains?: string[];
  livecrawl_formats?: LiveCrawlFormat[];
}

export interface PageContents {
  html?: string;
  markdown?: string;
}

export interface WebResult {
  url?: string;
  title?: string;
  description?: string;
  snippets?: string[];
  thumbnail_url?: string;
  page_age?: string;
  contents?: PageContents;
  authors?: string[];
  favicon_url?: string;
}

export interface NewsResult {
  title?: string;
  description?: string;
  page_age?: string;
  thumbnail_url?: string;
  url?: string;
  contents?: PageContents;
}

export interface SearchResponseResults {
  web?: WebResult[];
  news?: NewsResult[];
}

export interface SearchMetadata {
  search_uuid?: string;
  query?: string;
  latency?: number;
}

export interface SearchResponse {
  results?: SearchResponseResults;
  metadata?: SearchMetadata;
}

// ============================================
// Research
// ============================================

export type ResearchEffort = 'lite' | 'standard' | 'deep' | 'exhaustive';

export interface ResearchSourceControl {
  include_domains?: string[];
  exclude_domains?: string[];
  boost_domains?: string[];
  freshness?: Freshness | string;
  country?: CountryCode;
}

export interface ResearchOptions {
  input: string;
  research_effort?: ResearchEffort;
  source_control?: ResearchSourceControl;
  output_schema?: Record<string, unknown>;
}

export interface ResearchCitation {
  url?: string;
  title?: string;
  snippet?: string;
}

export interface ResearchOutput {
  content?: string;
  citations?: ResearchCitation[];
}

export interface ResearchResponse {
  output?: ResearchOutput;
  search_results?: SearchResponseResults;
  metadata?: Record<string, unknown>;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// API Error Types
// ============================================

export class YouSearchApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'YouSearchApiError';
    this.statusCode = statusCode;
  }
}
