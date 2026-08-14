import type { CrowdDevConfig } from '../types';
import { CrowdDevApiError } from '../types';

export class CrowdDevClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: CrowdDevConfig) {
    if (!config.apiKey || !config.tenantId) throw new Error('Crowd.dev apiKey and tenantId are required');
    this.apiKey = config.apiKey;
    this.baseUrl = `https://app.crowd.dev/api/tenant/${config.tenantId}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CrowdDevApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
