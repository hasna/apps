import type { OrttoConfig } from '../types';
import { OrttoApiError } from '../types';

export class OrttoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: OrttoConfig) {
    if (!config.apiKey) throw new Error('Ortto apiKey is required');
    this.apiKey = config.apiKey;
    const region = config.region || 'api';
    this.baseUrl = `https://${region}.ap3api.com/v1`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'POST', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new OrttoApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
