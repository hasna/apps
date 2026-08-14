import type { TeamgateConfig } from '../types';
import { TeamgateApiError } from '../types';

export class TeamgateClient {
  private readonly authToken: string;
  private readonly appKey: string;
  private readonly baseUrl = 'https://api.teamgate.com/v4';

  constructor(config: TeamgateConfig) {
    if (!config.authToken || !config.appKey) throw new Error('Teamgate authToken and appKey are required');
    this.authToken = config.authToken;
    this.appKey = config.appKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-Auth-Token': this.authToken, 'X-App-Key': this.appKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new TeamgateApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
