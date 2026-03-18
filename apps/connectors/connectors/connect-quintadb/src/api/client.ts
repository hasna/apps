import type { QuintaDBConfig } from '../types';
import { QuintaDBApiError } from '../types';
const DEFAULT_BASE_URL = 'https://quintadb.com/api/v2';
export class QuintaDBClient {
  private readonly apiKey: string;
  private readonly appId: string;
  private readonly baseUrl: string;
  constructor(config: QuintaDBConfig) {
    if (!config.apiKey || !config.appId) throw new Error('QuintaDB apiKey and appId are required');
    this.apiKey = config.apiKey; this.appId = config.appId;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }
  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}/apps/${this.appId}${path}`);
    url.searchParams.append('rest_api_key', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new QuintaDBApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
