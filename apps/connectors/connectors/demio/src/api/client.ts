import type { DemioConfig } from '../types';
import { DemioApiError } from '../types';

export class DemioClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl = 'https://my.demio.com/api/v1';

  constructor(config: DemioConfig) {
    if (!config.apiKey || !config.apiSecret) throw new Error('Demio apiKey and apiSecret are required');
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Api-Key': this.apiKey, 'Api-Secret': this.apiSecret, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new DemioApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
