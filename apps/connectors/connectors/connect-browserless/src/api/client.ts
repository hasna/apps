import type { BrowserlessConfig } from '../types';
import { BrowserlessApiError } from '../types';

export class BrowserlessClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: BrowserlessConfig) {
    if (!config.apiKey) throw new Error('Browserless apiKey is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://chrome.browserless.io').replace(/\/$/, '');
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'POST', body } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('token', this.apiKey);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new BrowserlessApiError(text || response.statusText, response.status);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return (await response.json()) as T;
    return { data: await response.text(), type: contentType } as T;
  }
}
