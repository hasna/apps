import type { CrossmintConfig } from '../types';
import { CrossmintApiError } from '../types';
export class CrossmintClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  constructor(config: CrossmintConfig) {
    if (!config.apiKey) throw new Error('Crossmint API key is required');
    this.apiKey = config.apiKey;
    const env = config.environment || 'production';
    this.baseUrl = config.baseUrl || (env === 'staging' ? 'https://staging.crossmint.com/api/2022-06-09' : 'https://www.crossmint.com/api/2022-06-09');
  }
  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CrossmintApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
