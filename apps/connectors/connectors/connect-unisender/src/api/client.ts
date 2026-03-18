import type { UniSenderConfig } from '../types';
import { UniSenderApiError } from '../types';

export class UniSenderClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.unisender.com/en/api';

  constructor(config: UniSenderConfig) {
    if (!config.apiKey) throw new Error('UniSender apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(method: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}/${method}`);
    url.searchParams.append('format', 'json');
    url.searchParams.append('api_key', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({})) as { result?: unknown; error?: string; code?: string };
    if (data.error) throw new UniSenderApiError(data.error, response.status, data.code);
    return (data.result ?? data) as T;
  }
}
