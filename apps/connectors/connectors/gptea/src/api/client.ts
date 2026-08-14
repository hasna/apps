import type { GPTeaConfig } from '../types';
import { GPTeaApiError } from '../types';

export class GPTeaClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.gptea.ai/v1';

  constructor(config: GPTeaConfig) {
    if (!config.apiKey) throw new Error('GPTea apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'POST', body } = options;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new GPTeaApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
