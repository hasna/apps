import type { EcwidConfig } from '../types';
import { EcwidApiError } from '../types';

export class EcwidClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: EcwidConfig) {
    if (!config.storeId || !config.token) throw new Error('Ecwid storeId and token are required');
    this.token = config.token;
    this.baseUrl = `https://app.ecwid.com/api/v3/${config.storeId}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('token', this.token);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new EcwidApiError((data as { errorMessage?: string })?.errorMessage || response.statusText, response.status);
    return data as T;
  }
}
