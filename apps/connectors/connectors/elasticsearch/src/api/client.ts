import type { ElasticsearchConfig } from '../types';
import { ElasticsearchApiError } from '../types';

export class ElasticsearchClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: ElasticsearchConfig) {
    if (!config.url) throw new Error('Elasticsearch url is required');
    this.baseUrl = config.url.replace(/\/$/, '');
    if (config.apiKey) {
      this.authHeader = `ApiKey ${config.apiKey}`;
    } else if (config.username && config.password) {
      this.authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    } else {
      this.authHeader = '';
    }
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> | string; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authHeader) headers.Authorization = this.authHeader;
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = (data as { error?: { reason?: string; type?: string } | string });
      const msg = typeof err.error === 'string' ? err.error : err.error?.reason || response.statusText;
      throw new ElasticsearchApiError(msg, response.status);
    }
    return data as T;
  }
}
