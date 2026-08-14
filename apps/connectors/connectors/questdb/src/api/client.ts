import type { QuestDBConfig } from '../types';
import { QuestDBApiError } from '../types';

export class QuestDBClient {
  private readonly baseUrl: string;
  private readonly authHeader?: string;

  constructor(config: QuestDBConfig) {
    if (!config.url) throw new Error('QuestDB url is required');
    this.baseUrl = config.url.replace(/\/$/, '');
    if (config.username && config.password) {
      this.authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    }
  }

  async request<T>(path: string, options: { method?: string; body?: string; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = {};
    if (this.authHeader) headers.Authorization = this.authHeader;
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = body;
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new QuestDBApiError((data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }
}
