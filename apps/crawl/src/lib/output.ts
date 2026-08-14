import type { ApiKey, Crawl, Page, SearchResult, Webhook, WebhookDelivery } from "../types/index.js";
import type { WebSearchResult } from "./search-web.js";

export const DEFAULT_LIST_LIMIT = 20;
export const DEFAULT_PREVIEW_LIMIT = 50;
export const MAX_HUMAN_LIMIT = 100;
export const DEFAULT_TEXT_PREVIEW_CHARS = 600;
export const MCP_TEXT_PREVIEW_CHARS = 1200;

export function parseLimit(
  value: string | number | undefined,
  defaultLimit = DEFAULT_LIST_LIMIT,
  maxLimit = MAX_HUMAN_LIMIT
): number {
  const parsed = typeof value === "number" ? value : value ? parseInt(value, 10) : defaultLimit;
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.min(Math.floor(parsed), maxLimit);
}

export function truncateText(value: string | null | undefined, maxChars = 120): string {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function shortId(id: string, length = 8): string {
  return id.slice(0, length);
}

export function compactCrawl(crawl: Crawl) {
  return {
    id: crawl.id,
    url: crawl.url,
    domain: crawl.domain,
    status: crawl.status,
    pagesCrawled: crawl.pagesCrawled,
    maxPages: crawl.maxPages,
    depth: crawl.depth,
    updatedAt: crawl.updatedAt,
    completedAt: crawl.completedAt,
    error: truncateText(crawl.errorMessage, 160) || null,
  };
}

export function compactPage(
  page: Page,
  opts: { includePreview?: boolean; previewChars?: number } = {}
) {
  const content = page.markdownContent ?? page.textContent;
  return {
    id: page.id,
    crawlId: page.crawlId,
    url: page.url,
    title: page.title,
    statusCode: page.statusCode,
    contentType: page.contentType,
    wordCount: page.wordCount,
    byteSize: page.byteSize,
    crawledAt: page.crawledAt,
    ...(opts.includePreview
      ? { preview: truncateText(content, opts.previewChars ?? DEFAULT_TEXT_PREVIEW_CHARS) || null }
      : {}),
  };
}

export function compactSearchResult(result: SearchResult) {
  return {
    pageId: result.page.id,
    crawlId: result.page.crawlId,
    url: result.page.url,
    title: result.page.title,
    snippet: truncateText(result.snippet, 220),
    rank: result.rank,
    wordCount: result.page.wordCount,
  };
}

export function compactWebhook(webhook: Webhook) {
  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    active: webhook.active,
    failureCount: webhook.failureCount,
    lastTriggeredAt: webhook.lastTriggeredAt,
    createdAt: webhook.createdAt,
    hasSecret: Boolean(webhook.secret),
  };
}

export function compactDelivery(delivery: WebhookDelivery, opts: { verbose?: boolean } = {}) {
  return {
    id: delivery.id,
    webhookId: delivery.webhookId,
    event: delivery.event,
    status: delivery.status,
    httpStatus: delivery.httpStatus,
    attemptCount: delivery.attemptCount,
    nextRetryAt: delivery.nextRetryAt,
    createdAt: delivery.createdAt,
    deliveredAt: delivery.deliveredAt,
    ...(opts.verbose
      ? {
          payloadPreview: truncateText(delivery.payload, 500) || null,
          responsePreview: truncateText(delivery.responseBody, 500) || null,
        }
      : {}),
  };
}

export function compactApiKey(key: ApiKey) {
  return {
    id: key.id,
    keyPrefix: key.keyPrefix,
    name: key.name,
    active: key.active,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
  };
}

export function compactWebSearchResult(result: WebSearchResult, opts: { includePage?: boolean } = {}) {
  return {
    url: result.url,
    title: result.title,
    snippet: truncateText(result.snippet, 220),
    publishedDate: result.publishedDate,
    ...(result.page
      ? {
          scrapedPage: opts.includePage
            ? compactPage(result.page, { includePreview: true, previewChars: DEFAULT_TEXT_PREVIEW_CHARS })
            : { id: result.page.id, statusCode: result.page.statusCode, wordCount: result.page.wordCount },
        }
      : {}),
  };
}

export function limitedHint(
  shown: number,
  requestedOrTotal: number,
  detail: string
): string | null {
  if (requestedOrTotal <= shown) return null;
  return `Showing ${shown} of ${requestedOrTotal}. ${detail}`;
}
