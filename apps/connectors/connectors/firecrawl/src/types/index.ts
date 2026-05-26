// Firecrawl Connector Types

// ============================================
// Configuration
// ============================================

export interface FirecrawlConfig {
  apiKey: string;
  baseUrl?: string; // Override default base URL (https://api.firecrawl.dev/v1)
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type ScrapeFormat = 'markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot' | 'screenshot@fullPage';

export interface Action {
  type: 'wait' | 'click' | 'write' | 'press' | 'screenshot' | 'scroll';
  selector?: string;
  milliseconds?: number;
  text?: string;
  key?: string;
  direction?: 'up' | 'down';
  amount?: number;
}

// ============================================
// Scrape Types
// ============================================

export interface ScrapeRequest {
  url: string;
  formats?: ScrapeFormat[];
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  headers?: Record<string, string>;
  waitFor?: number;
  mobile?: boolean;
  skipTlsVerification?: boolean;
  timeout?: number;
  actions?: Action[];
  extract?: {
    schema?: Record<string, unknown>;
    systemPrompt?: string;
    prompt?: string;
  };
  location?: {
    country?: string;
    languages?: string[];
  };
}

export interface ScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    links?: string[];
    screenshot?: string;
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      keywords?: string;
      robots?: string;
      ogTitle?: string;
      ogDescription?: string;
      ogUrl?: string;
      ogImage?: string;
      ogAudio?: string;
      ogDeterminer?: string;
      ogLocale?: string;
      ogLocaleAlternate?: string[];
      ogSiteName?: string;
      ogVideo?: string;
      dcTermsCreated?: string;
      dcDateCreated?: string;
      dcDate?: string;
      dcTermsType?: string;
      dcType?: string;
      dcTermsAudience?: string;
      dcTermsSubject?: string;
      dcSubject?: string;
      dcDescription?: string;
      dcTermsKeywords?: string;
      modifiedTime?: string;
      publishedTime?: string;
      articleTag?: string;
      articleSection?: string;
      sourceURL?: string;
      statusCode?: number;
    };
    extract?: Record<string, unknown>;
    actions?: {
      screenshots?: string[];
    };
  };
  error?: string;
}

// ============================================
// Crawl Types
// ============================================

export interface CrawlRequest {
  url: string;
  excludePaths?: string[];
  includePaths?: string[];
  maxDepth?: number;
  ignoreSitemap?: boolean;
  limit?: number;
  allowBackwardLinks?: boolean;
  allowExternalLinks?: boolean;
  webhook?: string;
  scrapeOptions?: Omit<ScrapeRequest, 'url'>;
}

export interface CrawlStatusResponse {
  success: boolean;
  status: 'scraping' | 'completed' | 'failed' | 'cancelled';
  total?: number;
  completed?: number;
  creditsUsed?: number;
  expiresAt?: string;
  next?: string;
  data?: ScrapeResponse['data'][];
  error?: string;
}

export interface CrawlStartResponse {
  success: boolean;
  id?: string;
  url?: string;
  error?: string;
}

export interface CrawlCancelResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// ============================================
// Map Types
// ============================================

export interface MapRequest {
  url: string;
  search?: string;
  ignoreSitemap?: boolean;
  sitemapOnly?: boolean;
  includeSubdomains?: boolean;
  limit?: number;
}

export interface MapResponse {
  success: boolean;
  links?: string[];
  error?: string;
}

// ============================================
// Search Types (Beta)
// ============================================

export interface SearchRequest {
  query: string;
  limit?: number;
  lang?: string;
  country?: string;
  location?: string;
  tbs?: string; // Time-based search parameter
  filter?: string;
  scrapeOptions?: Omit<ScrapeRequest, 'url'>;
}

export interface SearchResponse {
  success: boolean;
  data?: Array<{
    url: string;
    markdown?: string;
    html?: string;
    rawHtml?: string;
    links?: string[];
    screenshot?: string;
    metadata?: ScrapeResponse['data'] extends { metadata?: infer M } ? M : never;
  }>;
  error?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class FirecrawlApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'FirecrawlApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
