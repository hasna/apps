// One Simple API Connector — Utility APIs for screenshots, PDFs, and scraping
import { OneSimpleAPIClient } from './client';
import type { OneSimpleAPIConfig, OSScreenshot, OSPdf, OSScrape, OSQRCode, OSExchangeRate } from '../types';
export { OneSimpleAPIClient } from './client';

export class OneSimpleAPI {
  private readonly client: OneSimpleAPIClient;
  constructor(config: OneSimpleAPIConfig) { this.client = new OneSimpleAPIClient(config); }
  static fromEnv(): OneSimpleAPI {
    const apiKey = process.env.ONESIMPLEAPI_API_KEY;
    if (!apiKey) throw new Error('ONESIMPLEAPI_API_KEY is required');
    return new OneSimpleAPI({ apiKey });
  }

  async screenshot(url: string, options?: { full_page?: boolean; width?: number; height?: number; format?: string }): Promise<OSScreenshot> {
    return this.client.request<OSScreenshot>('/screenshot', { url, full_page: options?.full_page ? 'true' : undefined, width: options?.width, height: options?.height, output: options?.format });
  }

  async urlToPdf(url: string, options?: { format?: string; landscape?: boolean }): Promise<OSPdf> {
    return this.client.request<OSPdf>('/pdf', { url, format: options?.format, landscape: options?.landscape ? 'true' : undefined });
  }

  async scrape(url: string): Promise<OSScrape> { return this.client.request<OSScrape>('/scrape', { url }); }

  async generateQRCode(data: string, options?: { size?: number }): Promise<OSQRCode> {
    return this.client.request<OSQRCode>('/qr_code', { data, size: options?.size });
  }

  async getExchangeRate(base: string, target: string): Promise<OSExchangeRate> {
    return this.client.request<OSExchangeRate>('/exchange_rate', { base, target });
  }

  async shortenUrl(url: string): Promise<{ short_url: string }> {
    return this.client.request('/shorten', { url });
  }

  getClient(): OneSimpleAPIClient { return this.client; }
}
