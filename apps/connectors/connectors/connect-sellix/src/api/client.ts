import type { SellixConfig } from '../types';
import { SellixApiError } from '../types';

export class SellixClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://dev.sellix.io/v1';

  constructor(config: SellixConfig) {
    if (!config.apiKey) throw new Error('Sellix apiKey is required');
    this.apiKey = config.apiKey;
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
    const data = await response.json().catch(() => ({})) as { status?: number; data?: unknown; error?: string; message?: string };
    if (!response.ok || data.status !== 200) throw new SellixApiError(data.error || data.message || response.statusText, response.status);
    return (data.data ?? data) as T;
  }
}
