import type { RundeckConfig } from '../types';
import { RundeckApiError } from '../types';

export class RundeckClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: RundeckConfig) {
    if (!config.url || !config.token) throw new Error('Rundeck url and token are required');
    this.token = config.token;
    const version = config.apiVersion || 41;
    this.baseUrl = `${config.url.replace(/\/$/, '')}/api/${version}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-Rundeck-Auth-Token': this.token, Accept: 'application/json', 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RundeckApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
