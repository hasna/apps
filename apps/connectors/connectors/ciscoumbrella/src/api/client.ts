import type { CiscoUmbrellaConfig } from '../types';
import { CiscoUmbrellaApiError } from '../types';

export class CiscoUmbrellaClient {
  private readonly orgId: string;
  private readonly authHeader: string;
  private readonly baseUrl = 'https://api.umbrella.com';

  constructor(config: CiscoUmbrellaConfig) {
    if (!config.apiKey || !config.apiSecret || !config.orgId) throw new Error('Cisco Umbrella apiKey, apiSecret, and orgId are required');
    this.orgId = config.orgId;
    this.authHeader = `Basic ${btoa(`${config.apiKey}:${config.apiSecret}`)}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CiscoUmbrellaApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }

  getOrgId(): string { return this.orgId; }
}
