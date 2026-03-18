import type { OneAIConfig } from '../types';
import { OneAIApiError } from '../types';

export class OneAIClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.oneai.com/api/v0';

  constructor(config: OneAIConfig) {
    if (!config.apiKey) throw new Error('One AI apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'POST', body } = options;
    const headers: Record<string, string> = { 'api-key': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new OneAIApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
