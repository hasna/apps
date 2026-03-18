import type { TestMonitorConfig } from '../types';
import { TestMonitorApiError } from '../types';

export class TestMonitorClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: TestMonitorConfig) {
    if (!config.domain || !config.token) throw new Error('TestMonitor domain and token are required');
    this.token = config.token;
    this.baseUrl = `https://${config.domain}.testmonitor.com/api/v1`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new TestMonitorApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
