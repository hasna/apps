import type { CarbonBlackConfig } from '../types';
import { CarbonBlackApiError } from '../types';

export class CarbonBlackClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: CarbonBlackConfig) {
    if (!config.url || !config.orgKey || !config.apiId || !config.apiSecretKey) throw new Error('Carbon Black url, orgKey, apiId, and apiSecretKey are required');
    this.apiToken = `${config.apiSecretKey}/${config.apiId}`;
    this.baseUrl = `${config.url.replace(/\/$/, '')}/appservices/v6/orgs/${config.orgKey}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-Auth-Token': this.apiToken, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CarbonBlackApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
