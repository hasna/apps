// Wordfence API Platform — Wordfence Intelligence v3 vulnerability feed
import { WordfenceApiPlatformClient } from './client';
import type {
  RawRequestOptions,
  VulnerabilityFeed,
  WFListEventsOptions,
  WFSearchOptions,
  WFVulnerability,
  WFVulnerabilityFeed,
  WordfenceApiPlatformConfig,
} from '../types';

export { WordfenceApiPlatformClient, DEFAULT_BASE_URL } from './client';

function feedPath(feed: VulnerabilityFeed = 'production'): string {
  return `/vulnerabilities/${feed}`;
}

function normalizeFeed(feed: WFVulnerabilityFeed): WFVulnerabilityFeed {
  const normalized: WFVulnerabilityFeed = {};
  for (const [id, item] of Object.entries(feed)) {
    normalized[id] = { ...item, id };
  }
  return normalized;
}

function matchesQuery(vuln: WFVulnerability, options: WFSearchOptions): boolean {
  const haystack = [
    vuln.id,
    vuln.title,
    vuln.description,
    vuln.cve,
    ...(vuln.software || []).flatMap((s) => [s.slug, s.name, s.type]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (options.cve && String(vuln.cve || '').toLowerCase() !== options.cve.toLowerCase()) {
    return false;
  }

  if (options.pluginSlug) {
    const slug = options.pluginSlug.toLowerCase();
    const hasSlug = (vuln.software || []).some((s) => String(s.slug || '').toLowerCase() === slug);
    if (!hasSlug) return false;
  }

  if (options.query) {
    return haystack.includes(options.query.toLowerCase());
  }

  return true;
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class WordfenceApiPlatform {
  private readonly client: WordfenceApiPlatformClient;

  constructor(config: WordfenceApiPlatformConfig) {
    this.client = new WordfenceApiPlatformClient(config);
  }

  static fromEnv(): WordfenceApiPlatform {
    const apiKey = process.env.WORDFENCE_API_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('WORDFENCE_API_PLATFORM_API_KEY is required');
    }
    return new WordfenceApiPlatform({
      apiKey,
      baseUrl: process.env.WORDFENCE_API_PLATFORM_BASE_URL,
    });
  }

  async listVulnerabilities(feed: VulnerabilityFeed = 'production'): Promise<WFVulnerabilityFeed> {
    const data = await this.client.request<WFVulnerabilityFeed>(feedPath(feed));
    return normalizeFeed(data);
  }

  /** Alumia inventory parity: listItems */
  async listItems(options: { feed?: VulnerabilityFeed } = {}): Promise<WFVulnerabilityFeed> {
    return this.listVulnerabilities(options.feed);
  }

  async getVulnerability(itemId: string, feed: VulnerabilityFeed = 'production'): Promise<WFVulnerability> {
    const all = await this.listVulnerabilities(feed);
    const item = all[itemId];
    if (!item) {
      throw new Error(`Vulnerability not found: ${itemId}`);
    }
    return item;
  }

  /** Alumia inventory parity: getItem */
  async getItem(args: { itemId: string; feed?: VulnerabilityFeed }): Promise<WFVulnerability> {
    return this.getVulnerability(args.itemId, args.feed);
  }

  /** Intelligence feed is read-only; create is not supported by the public API. */
  async createItem(): Promise<never> {
    throw new Error(
      'Wordfence Intelligence vulnerability feed is read-only; createItem is not supported. Use list/search to consume published vulnerabilities.',
    );
  }

  async listRecentVulnerabilities(options: WFListEventsOptions = {}): Promise<WFVulnerability[]> {
    const feed = await this.listVulnerabilities(options.feed);
    const since = parseDate(options.since);
    const until = parseDate(options.until);

    const items = Object.values(feed).filter((vuln) => {
      const published = parseDate(vuln.published) || parseDate(vuln.updated);
      if (!published) return false;
      if (since && published < since) return false;
      if (until && published > until) return false;
      return true;
    });

    items.sort((a, b) => {
      const aDate = parseDate(a.published)?.getTime() || 0;
      const bDate = parseDate(b.published)?.getTime() || 0;
      return bDate - aDate;
    });

    if (options.limit && options.limit > 0) {
      return items.slice(0, options.limit);
    }

    return items;
  }

  /** Alumia inventory parity: listEvents */
  async listEvents(options: WFListEventsOptions = {}): Promise<WFVulnerability[]> {
    return this.listRecentVulnerabilities(options);
  }

  async searchVulnerabilities(options: WFSearchOptions): Promise<WFVulnerability[]> {
    const feed = await this.listVulnerabilities(options.feed);
    const results = Object.values(feed).filter((vuln) => matchesQuery(vuln, options));

    if (options.limit && options.limit > 0) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  /** Alumia inventory parity: search */
  async search(args: WFSearchOptions): Promise<WFVulnerability[]> {
    return this.searchVulnerabilities(args);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const method = (options.method || 'GET').toUpperCase();
    return this.client.request<T>(options.path, {
      method,
      params: options.query,
      body: options.body,
      headers: options.headers,
    });
  }

  getClient(): WordfenceApiPlatformClient {
    return this.client;
  }
}
