import type { NucliaConfig } from '../types';
import { NucliaApiError } from '../types';

export class NucliaClient {
  private readonly serviceToken: string;
  private readonly baseUrl: string;

  constructor(config: NucliaConfig) {
    if (!config.serviceToken || !config.zone || !config.kbId) throw new Error('Nuclia serviceToken, zone, and kbId are required');
    this.serviceToken = config.serviceToken;
    this.baseUrl = `https://${config.zone}.nuclia.cloud/api/v1/kb/${config.kbId}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-NUCLIA-SERVICEACCOUNT': `Bearer ${this.serviceToken}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new NucliaApiError((data as { detail?: string })?.detail || response.statusText, response.status);
    return data as T;
  }
}
