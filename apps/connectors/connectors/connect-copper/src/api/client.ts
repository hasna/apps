import type { CopperConfig } from '../types';
import { CopperApiError } from '../types';

export class CopperClient {
  private readonly apiKey: string;
  private readonly email: string;
  private readonly baseUrl = 'https://api.copper.com/developer_api/v1';

  constructor(config: CopperConfig) {
    if (!config.apiKey || !config.email) throw new Error('Copper apiKey and email are required');
    this.apiKey = config.apiKey;
    this.email = config.email;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-PW-AccessToken': this.apiKey, 'X-PW-Application': 'developer_api', 'X-PW-UserEmail': this.email, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CopperApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
