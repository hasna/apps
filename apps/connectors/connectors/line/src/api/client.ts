import type { LINEConfig } from '../types';
import { LINEApiError } from '../types';

export class LINEClient {
  private readonly token: string;
  private readonly baseUrl = 'https://api.line.me/v2/bot';

  constructor(config: LINEConfig) {
    if (!config.channelAccessToken) throw new Error('LINE channelAccessToken is required');
    this.token = config.channelAccessToken;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 200) {
      const text = await response.text();
      if (!text || text === '{}') return {} as T;
      return JSON.parse(text) as T;
    }
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new LINEApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
