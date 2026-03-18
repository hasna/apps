import type { HubPlannerConfig } from '../types';
import { HubPlannerApiError } from '../types';

const DEFAULT_BASE_URL = 'https://app.hubplanner.com/v1';

export class HubPlannerClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: HubPlannerConfig) {
    if (!config.apiKey) throw new Error('Hub Planner API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });

    const headers: Record<string, string> = { Authorization: this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { message?: string; error?: string })?.message || (data as { error?: string })?.error || response.statusText;
      throw new HubPlannerApiError(msg, response.status);
    }
    return data as T;
  }
}
