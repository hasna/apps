import type { KibanaConfig } from '../types';
import { KibanaApiError } from '../types';

export class KibanaClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: KibanaConfig) {
    if (!config.url) throw new Error('Kibana url is required');
    this.baseUrl = `${config.url.replace(/\/$/, '')}/api`;
    if (config.apiKey) {
      this.authHeader = `ApiKey ${config.apiKey}`;
    } else if (config.username && config.password) {
      this.authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    } else {
      throw new Error('Kibana apiKey or username/password is required');
    }
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json', 'kbn-xsrf': 'true' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new KibanaApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
