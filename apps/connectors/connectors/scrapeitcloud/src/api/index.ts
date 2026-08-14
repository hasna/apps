// ScrapeIt Cloud Connector — Cloud-based web scraping and data extraction
import { ScrapeItCloudClient } from './client';
import type { ScrapeItCloudConfig, SICResult, SICScreenshot, SICExtractResult, SICCredits } from '../types';
export { ScrapeItCloudClient } from './client';

export class ScrapeItCloud {
  private readonly client: ScrapeItCloudClient;
  constructor(config: ScrapeItCloudConfig) { this.client = new ScrapeItCloudClient(config); }
  static fromEnv(): ScrapeItCloud {
    const apiKey = process.env.SCRAPEITCLOUD_API_KEY;
    if (!apiKey) throw new Error('SCRAPEITCLOUD_API_KEY is required');
    return new ScrapeItCloud({ apiKey });
  }

  async scrape(url: string, options?: { proxy_country?: string; render_js?: boolean; wait_for?: string; block_resources?: boolean }): Promise<SICResult> {
    return this.client.request<SICResult>('/scrape', { body: { url, proxy_country: options?.proxy_country, render_js: options?.render_js, wait_for: options?.wait_for, block_resources: options?.block_resources } as Record<string, unknown> });
  }

  async screenshot(url: string, options?: { full_page?: boolean; width?: number; height?: number; format?: string }): Promise<SICScreenshot> {
    return this.client.request<SICScreenshot>('/screenshot', { body: { url, full_page: options?.full_page, width: options?.width, height: options?.height, format: options?.format } as Record<string, unknown> });
  }

  async extract(url: string, rules: Record<string, { selector: string; type?: string; attribute?: string }>): Promise<SICExtractResult> {
    return this.client.request<SICExtractResult>('/extract', { body: { url, rules } as Record<string, unknown> });
  }

  async getCredits(): Promise<SICCredits> { return this.client.request<SICCredits>('/account/credits', { method: 'GET' }); }

  getClient(): ScrapeItCloudClient { return this.client; }
}
