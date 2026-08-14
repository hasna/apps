import type { HunterConfig } from '../types';
import { HunterApiError } from '../types';

export class HunterClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.hunter.io/v2';

  constructor(config: HunterConfig) {
    if (!config.apiKey) throw new Error('Hunter apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('api_key', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({})) as { data?: unknown; errors?: { details?: string }[] };
    if (!response.ok || data.errors) throw new HunterApiError(data.errors?.[0]?.details || response.statusText, response.status);
    return (data.data ?? data) as T;
  }
}
