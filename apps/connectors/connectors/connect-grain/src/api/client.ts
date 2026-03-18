import type { GrainConfig } from '../types';
import { GrainApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.grain.com/v1';

export class GrainClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  constructor(config: GrainConfig) {
    if (!config.apiKey) throw new Error('Grain API key is required');
    this.apiKey = config.apiKey; this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }
  async request<T>(path: string, options: { method?: string; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString(), { method, headers: { Authorization: `Bearer ${this.apiKey}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new GrainApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
