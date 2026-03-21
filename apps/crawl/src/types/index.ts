// ─── Crawl Types ────────────────────────────────────────────────────────────

export type CrawlStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface CrawlOptions {
  depth?: number;
  maxPages?: number;
  delay?: number;
  maxConcurrent?: number;
  headers?: Record<string, string>;
  cookies?: string;
  respectRobots?: boolean;
  render?: boolean;
  screenshot?: boolean;
  storeHtml?: boolean;
  userAgent?: string;
  timeout?: number;
}

export interface Crawl {
  id: string;
  url: string;
  domain: string | null;
  status: CrawlStatus;
  depth: number;
  maxPages: number;
  pagesCrawled: number;
  options: CrawlOptions;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface CreateCrawlInput {
  url: string;
  depth?: number;
  maxPages?: number;
  options?: CrawlOptions;
}

// ─── Page Types ──────────────────────────────────────────────────────────────

export interface PageMetadata {
  headings?: Array<{ level: number; text: string }>;
  links?: Array<{ href: string; text: string }>;
  images?: Array<{ src: string; alt: string }>;
  openGraph?: Record<string, string>;
  twitterCard?: Record<string, string>;
  jsonLd?: unknown[];
  canonicalUrl?: string;
  lang?: string;
  robots?: string;
}

export interface Page {
  id: string;
  crawlId: string;
  url: string;
  statusCode: number | null;
  contentType: string | null;
  title: string | null;
  description: string | null;
  textContent: string | null;
  markdownContent: string | null;
  htmlContent: string | null;
  metadata: PageMetadata;
  screenshotPath: string | null;
  wordCount: number | null;
  byteSize: number | null;
  crawledAt: string;
}

export interface CreatePageInput {
  crawlId: string;
  url: string;
  statusCode?: number;
  contentType?: string;
  title?: string;
  description?: string;
  textContent?: string;
  markdownContent?: string;
  htmlContent?: string;
  metadata?: PageMetadata;
  screenshotPath?: string;
  wordCount?: number;
  byteSize?: number;
}

// ─── Fetch Types ─────────────────────────────────────────────────────────────

export interface FetchOptions {
  headers?: Record<string, string>;
  cookies?: string;
  timeout?: number;
  maxRedirects?: number;
  userAgent?: string;
  delay?: number;
}

export interface FetchResult {
  url: string;
  redirectedTo: string | null;
  statusCode: number;
  contentType: string;
  html: string;
  headers: Record<string, string>;
  byteSize: number;
}

// ─── Extraction Types ────────────────────────────────────────────────────────

export interface ExtractedContent {
  title: string | null;
  description: string | null;
  text: string;
  markdown: string;
  links: Array<{ href: string; text: string }>;
  images: Array<{ src: string; alt: string }>;
  headings: Array<{ level: number; text: string }>;
  metadata: PageMetadata;
  wordCount: number;
}

// ─── AI Extraction Types ─────────────────────────────────────────────────────

export type AiProvider = "openai" | "anthropic";

export interface AiExtractionOptions {
  provider?: AiProvider;
  model?: string;
}

// ─── Config Types ────────────────────────────────────────────────────────────

export interface CrawlConfig {
  userAgent: string;
  defaultDelay: number;
  maxConcurrent: number;
  maxDepth: number;
  maxPages: number;
  storeHtml: boolean;
  defaultRender: boolean;
  aiProvider: AiProvider;
  screenshotViewport: { width: number; height: number };
  dbPath?: string;
}

// ─── Search Types ────────────────────────────────────────────────────────────

export interface SearchResult {
  page: Page;
  snippet: string;
  rank: number;
}

export interface SearchOptions {
  domain?: string;
  crawlId?: string;
  limit?: number;
  offset?: number;
}

// ─── Export Types ────────────────────────────────────────────────────────────

export type ExportFormat = "json" | "md" | "csv";

// ─── Page Version Types ──────────────────────────────────────────────────────

export interface PageVersion {
  id: string;
  pageId: string;
  textContent: string | null;
  crawledAt: string;
  diffSummary: string | null;
}
