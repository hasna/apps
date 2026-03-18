import type { ZohoCRMConfig } from '../types';
import { ZohoCRMApiError } from '../types';

export class ZohoCRMClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: ZohoCRMConfig) {
    if (!config.token) throw new Error('Zoho CRM token is required');
    this.token = config.token;
    this.baseUrl = (config.baseUrl || 'https://www.zohoapis.com/crm/v5').replace(/\/$/, '');
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${this.token}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = (data as { message?: string; code?: string });
      throw new ZohoCRMApiError(err.message || response.statusText, response.status, err.code);
    }
    return data as T;
  }
}
