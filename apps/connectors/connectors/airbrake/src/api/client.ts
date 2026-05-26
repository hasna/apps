import type { AirbrakeConfig } from '../types';
import { AirbrakeApiError } from '../types';

export class AirbrakeClient {
  private readonly projectKey: string;
  private readonly projectId: string;
  private readonly baseUrl: string;

  constructor(config: AirbrakeConfig) {
    if (!config.projectId || !config.projectKey) throw new Error('Airbrake projectId and projectKey are required');
    this.projectKey = config.projectKey;
    this.projectId = config.projectId;
    this.baseUrl = (config.baseUrl || 'https://api.airbrake.io').replace(/\/$/, '');
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}/api/v4/projects/${this.projectId}${path}`);
    url.searchParams.append('key', this.projectKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new AirbrakeApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
