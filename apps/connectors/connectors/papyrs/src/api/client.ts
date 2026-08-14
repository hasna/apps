import type { PapyrsConfig } from '../types';
import { PapyrsApiError } from '../types';

export class PapyrsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: PapyrsConfig) {
    if (!config.subdomain || !config.apiKey) throw new Error('Papyrs subdomain and apiKey are required');
    this.apiKey = config.apiKey;
    this.baseUrl = `https://${config.subdomain}.papyrs.com/api/v1`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new PapyrsApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
