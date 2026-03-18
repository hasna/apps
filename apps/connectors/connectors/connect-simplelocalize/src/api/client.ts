import type { SimpleLocalizeConfig } from '../types';
import { SimpleLocalizeApiError } from '../types';
const DEFAULT_BASE_URL = 'https://api.simplelocalize.io/api/v2';
export class SimpleLocalizeClient {
  private readonly apiKey: string;
  private readonly projectToken: string | undefined;
  private readonly baseUrl: string;
  constructor(config: SimpleLocalizeConfig) {
    if (!config.apiKey) throw new Error('SimpleLocalize API key is required');
    this.apiKey = config.apiKey;
    this.projectToken = config.projectToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }
  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.append(k, v); });
    const headers: Record<string, string> = { 'X-SimpleLocalize-Token': this.apiKey, 'Content-Type': 'application/json' };
    if (this.projectToken) headers['X-Project-Token'] = this.projectToken;
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new SimpleLocalizeApiError((data as { msg?: string })?.msg || response.statusText, response.status);
    return data as T;
  }
}
