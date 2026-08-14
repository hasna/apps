import type { TrackViaConfig } from '../types';
import { TrackViaApiError } from '../types';

export class TrackViaClient {
  private readonly token: string;
  private readonly accountId: string;
  private readonly baseUrl = 'https://go.trackvia.com/openapi';

  constructor(config: TrackViaConfig) {
    if (!config.token || !config.accountId) throw new Error('TrackVia token and accountId are required');
    this.token = config.token;
    this.accountId = config.accountId;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('user_key', this.token);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'Account-Id': this.accountId };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new TrackViaApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
