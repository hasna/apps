import type { GoogleTranslateConfig } from '../types';
import { GoogleTranslateApiError } from '../types';

export class GoogleTranslateClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://translation.googleapis.com/language/translate/v2';

  constructor(config: GoogleTranslateConfig) {
    if (!config.apiKey) throw new Error('Google Translate apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('key', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = (data as { error?: { message?: string } })?.error;
      throw new GoogleTranslateApiError(err?.message || response.statusText, response.status);
    }
    return data as T;
  }
}
