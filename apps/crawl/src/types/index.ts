// ─── Crawl Types ────────────────────────────────────────────────────────────

export type CrawlStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// ─── Browser Action Types ─────────────────────────────────────────────────────

export type BrowserAction =
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | { type: "scroll"; x?: number; y?: number }
  | { type: "wait"; ms: number }
  | { type: "waitForSelector"; selector: string; timeout?: number }
  | { type: "screenshot" };

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
  include?: string[];   // URL patterns to include (e.g. ["/blog", "/docs"])
  exclude?: string[];   // URL patterns to exclude (e.g. ["/admin", ".pdf"])
  onProgress?: (info: { url: string; pageNumber: number; total?: number }) => void;
  ignoreQueryParameters?: boolean;
  allowSubdomains?: boolean;
  allowExternalLinks?: boolean;
  onlyMainContent?: boolean; // default true
  maxAge?: number; // ms — return cached page if crawled within this window
  proxy?: string;
  skipTlsVerification?: boolean;
  actions?: BrowserAction[]; // pre-scrape browser actions (requires Playwright)
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
  noindex?: boolean;
  nofollow?: boolean;
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
  proxy?: string;
  skipTlsVerification?: boolean;
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
  defaultMaxAge?: number; // 0 = disabled
  defaultProxy?: string;
  requireAuth?: boolean; // default false — require API key on /api/ and /v1/ routes
  rateLimit?: number; // default 60 — max requests per minute per API key (or IP if no auth)
}

// ─── Branding Types ───────────────────────────────────────────────────────────

export interface BrandingResult {
  logo: string | null;
  favicon: string | null;
  themeColor: string | null;
  fonts: string[];
  colors: string[];
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

// ─── Webhook Types ────────────────────────────────────────────────────────────

export type WebhookEvent = "crawl.started" | "crawl.completed" | "crawl.failed" | "page.crawled";

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret: string | null;
  active: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
  failureCount: number;
}

// ─── API Key Types ────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  keyHash: string;
  keyPrefix: string;
  name: string | null;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

// ─── Usage Types ─────────────────────────────────────────────────────────────

export type UsageEventType = "crawl_page" | "map_url" | "search_result" | "ai_extraction" | "screenshot";

export interface UsageEvent {
  id: string;
  apiKeyId: string | null;
  eventType: UsageEventType;
  credits: number;
  crawlId: string | null;
  pageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageSummary {
  totalCredits: number;
  byType: Record<string, { count: number; credits: number }>;
  period: { from: string; to: string };
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: WebhookEvent;
  payload: string;
  status: "pending" | "delivered" | "failed";
  httpStatus: number | null;
  responseBody: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
}
