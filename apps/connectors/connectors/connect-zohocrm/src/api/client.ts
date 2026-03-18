import type { ZohoCRMConfig } from '../types';
import { ZohoCRMApiError } from '../types';

export class ZohoCRMClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(config: ZohoCRMConfig) {
    if (!config.accessToken) throw new Error('Zoho CRM access token is required');
    this.accessToken = config.accessToken;
    const region = config.region || 'com';
    this.baseUrl = config.baseUrl || `https://www.zohoapis.${region}/crm/v2`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });

    const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${this.accessToken}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { message?: string; code?: string })?.message || response.statusText;
      throw new ZohoCRMApiError(msg, response.status);
    }
    return data as T;
  }
}
