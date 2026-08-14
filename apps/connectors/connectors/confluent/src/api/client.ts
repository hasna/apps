import type { ConfluentConfig } from '../types';
import { ConfluentApiError } from '../types';

export class ConfluentClient {
  private readonly authHeader: string;
  private readonly baseUrl = 'https://api.confluent.cloud';

  constructor(config: ConfluentConfig) {
    if (!config.apiKey || !config.apiSecret) throw new Error('Confluent apiKey and apiSecret are required');
    this.authHeader = `Basic ${btoa(`${config.apiKey}:${config.apiSecret}`)}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = (data as { errors?: { detail?: string }[] });
      throw new ConfluentApiError(err.errors?.[0]?.detail || response.statusText, response.status);
    }
    return data as T;
  }
}
