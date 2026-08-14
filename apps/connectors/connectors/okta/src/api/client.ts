import type { OktaConfig } from '../types';
import { OktaApiError } from '../types';

export class OktaClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: OktaConfig) {
    if (!config.domain || !config.token) throw new Error('Okta domain and token are required');
    this.token = config.token;
    this.baseUrl = `https://${config.domain}/api/v1`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `SSWS ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = data as { errorSummary?: string; errorCode?: string };
      throw new OktaApiError(err.errorSummary || response.statusText, response.status, err.errorCode);
    }
    return data as T;
  }
}
