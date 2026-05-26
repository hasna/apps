import type { FirecrawlClient } from './client';
import type { ScrapeRequest, ScrapeResponse, ScrapeFormat } from '../types';

/**
 * Scrape API - Scrape single URLs
 */
export class ScrapeApi {
  constructor(private readonly client: FirecrawlClient) {}

  /**
   * Scrape a single URL
   * @param url - The URL to scrape
   * @param options - Scrape options
   */
  async scrape(url: string, options?: Omit<ScrapeRequest, 'url'>): Promise<ScrapeResponse> {
    const body: ScrapeRequest = {
      url,
      ...options,
    };

    return this.client.post<ScrapeResponse>('/scrape', body);
  }

  /**
   * Scrape a URL with screenshot
   * @param url - The URL to scrape
   * @param fullPage - Whether to capture full page screenshot
   */
  async scrapeWithScreenshot(url: string, fullPage = false): Promise<ScrapeResponse> {
    const formats: ScrapeFormat[] = fullPage
      ? ['markdown', 'screenshot@fullPage']
      : ['markdown', 'screenshot'];

    return this.scrape(url, { formats });
  }

  /**
   * Scrape a URL and extract structured data using AI
   * @param url - The URL to scrape
   * @param schema - JSON schema for extraction
   * @param prompt - Optional extraction prompt
   */
  async scrapeWithExtraction(
    url: string,
    schema: Record<string, unknown>,
    prompt?: string
  ): Promise<ScrapeResponse> {
    return this.scrape(url, {
      formats: ['markdown'],
      extract: {
        schema,
        prompt,
      },
    });
  }

  /**
   * Scrape a URL with JavaScript actions
   * @param url - The URL to scrape
   * @param actions - Actions to perform before scraping
   */
  async scrapeWithActions(
    url: string,
    actions: ScrapeRequest['actions']
  ): Promise<ScrapeResponse> {
    return this.scrape(url, {
      formats: ['markdown'],
      actions,
    });
  }
}
