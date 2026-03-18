import type { SpecterConfig } from '../types';
import { SpecterApiError } from '../types';

export class SpecterClient {
  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly baseUrl = 'https://api.specterapp.xyz/v1';

  constructor(config: SpecterConfig) {
    if (!config.apiKey || !config.projectId) throw new Error('Specter apiKey and projectId are required');
    this.apiKey = config.apiKey;
    this.projectId = config.projectId;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}/projects/${this.projectId}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new SpecterApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
