import type { FlagshipConfig } from '../types';
import { FlagshipApiError } from '../types';

export class FlagshipClient {
  private readonly apiKey: string;
  private readonly environmentId: string;
  private readonly baseUrl = 'https://decision.flagship.io/v2';

  constructor(config: FlagshipConfig) {
    if (!config.apiKey || !config.environmentId) throw new Error('Flagship apiKey and environmentId are required');
    this.apiKey = config.apiKey;
    this.environmentId = config.environmentId;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}/${this.environmentId}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new FlagshipApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
