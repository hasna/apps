// Browserless Connector — Headless browser automation as a service
import { BrowserlessClient } from './client';
import type { BrowserlessConfig, BLScreenshotOptions, BLPdfOptions, BLContentResult, BLScrapeResult, BLPerformanceResult } from '../types';
export { BrowserlessClient } from './client';

export class Browserless {
  private readonly client: BrowserlessClient;
  constructor(config: BrowserlessConfig) { this.client = new BrowserlessClient(config); }
  static fromEnv(): Browserless {
    const apiKey = process.env.BROWSERLESS_API_KEY;
    if (!apiKey) throw new Error('BROWSERLESS_API_KEY is required');
    return new Browserless({ apiKey, baseUrl: process.env.BROWSERLESS_BASE_URL });
  }

  async screenshot(options: BLScreenshotOptions): Promise<BLContentResult> {
    return this.client.request<BLContentResult>('/screenshot', { body: options as Record<string, unknown> });
  }

  async pdf(options: BLPdfOptions): Promise<BLContentResult> {
    return this.client.request<BLContentResult>('/pdf', { body: options as Record<string, unknown> });
  }

  async content(url: string, options?: { gotoOptions?: { waitUntil?: string; timeout?: number } }): Promise<BLContentResult> {
    return this.client.request<BLContentResult>('/content', { body: { url, ...options } as Record<string, unknown> });
  }

  async scrape(url: string, elements: { selector: string; timeout?: number }[]): Promise<BLScrapeResult> {
    return this.client.request<BLScrapeResult>('/scrape', { body: { url, elements } as Record<string, unknown> });
  }

  async performance(url: string): Promise<BLPerformanceResult> {
    return this.client.request<BLPerformanceResult>('/performance', { body: { url } });
  }

  async execute(code: string, context?: Record<string, unknown>): Promise<unknown> {
    return this.client.request('/function', { body: { code, context } });
  }

  getClient(): BrowserlessClient { return this.client; }
}
