import type { EarthoConfig } from '../types';
import { EarthoApiError } from '../types';

export class EarthoClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl = 'https://api.eartho.io/v1';

  constructor(config: EarthoConfig) {
    if (!config.clientId || !config.clientSecret) throw new Error('Eartho clientId and clientSecret are required');
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'x-api-key': this.clientSecret, 'x-client-id': this.clientId, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new EarthoApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
