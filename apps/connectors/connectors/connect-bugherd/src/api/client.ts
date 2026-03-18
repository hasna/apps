import type { BugHerdConfig } from '../types';
import { BugHerdApiError } from '../types';

export class BugHerdClient {
  private readonly authHeader: string;
  private readonly baseUrl = 'https://www.bugherd.com/api_v2';

  constructor(config: BugHerdConfig) {
    if (!config.apiKey) throw new Error('BugHerd apiKey is required');
    this.authHeader = `Basic ${btoa(`${config.apiKey}:x`)}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}.json`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new BugHerdApiError((data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }
}
