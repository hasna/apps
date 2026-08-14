import type { FirecrawlConfig } from '../types';
import { FirecrawlClient } from './client';
import { ScrapeApi } from './scrape';
import { CrawlApi } from './crawl';
import { MapApi } from './map';
import { SearchApi } from './search';

/**
 * Main Firecrawl connector class
 */
export class Firecrawl {
  private readonly client: FirecrawlClient;

  // API modules
  public readonly scrape: ScrapeApi;
  public readonly crawl: CrawlApi;
  public readonly map: MapApi;
  public readonly search: SearchApi;

  constructor(config: FirecrawlConfig) {
    this.client = new FirecrawlClient(config);
    this.scrape = new ScrapeApi(this.client);
    this.crawl = new CrawlApi(this.client);
    this.map = new MapApi(this.client);
    this.search = new SearchApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for FIRECRAWL_API_KEY and optionally FIRECRAWL_BASE_URL
   */
  static fromEnv(): Firecrawl {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    const baseUrl = process.env.FIRECRAWL_BASE_URL;

    if (!apiKey) {
      throw new Error('FIRECRAWL_API_KEY environment variable is required');
    }
    return new Firecrawl({ apiKey, baseUrl });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): FirecrawlClient {
    return this.client;
  }
}

export { FirecrawlClient } from './client';
export { ScrapeApi } from './scrape';
export { CrawlApi } from './crawl';
export { MapApi } from './map';
export { SearchApi } from './search';
