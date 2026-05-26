import type { TeamupConfig } from '../types';
import { TeamupApiError } from '../types';

export class TeamupClient {
  private readonly apiKey: string;
  private readonly calendarKey: string;
  private readonly baseUrl = 'https://api.teamup.com';

  constructor(config: TeamupConfig) {
    if (!config.apiKey || !config.calendarKey) throw new Error('Teamup apiKey and calendarKey are required');
    this.apiKey = config.apiKey;
    this.calendarKey = config.calendarKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}/${this.calendarKey}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Teamup-Token': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new TeamupApiError((data as { error?: { message?: string } })?.error?.message || response.statusText, response.status);
    return data as T;
  }
}
