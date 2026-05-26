import type { FortiGateConfig } from '../types';
import { FortiGateApiError } from '../types';

export class FortiGateClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: FortiGateConfig) {
    if (!config.url || !config.token) throw new Error('FortiGate url and token are required');
    this.token = config.token;
    this.baseUrl = `${config.url.replace(/\/$/, '')}/api/v2`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('access_token', this.token);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    const data = await response.json().catch(() => ({})) as { results?: unknown; http_status?: number; status?: string };
    if (!response.ok || data.status === 'error') throw new FortiGateApiError(response.statusText, response.status);
    return (data.results ?? data) as T;
  }
}
