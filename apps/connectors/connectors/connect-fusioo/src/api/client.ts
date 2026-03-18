import type { FusiooConfig } from '../types';
import { FusiooApiError } from '../types';

const DEFAULT_BASE_URL = 'https://www.fusioo.com/api/1.0';

export class FusiooClient {
  private readonly apiKey: string;
  private readonly workspaceId: string;
  private readonly baseUrl: string;

  constructor(config: FusiooConfig) {
    if (!config.apiKey) throw new Error('Fusioo API key is required');
    if (!config.workspaceId) throw new Error('Fusioo workspace ID is required');
    this.apiKey = config.apiKey;
    this.workspaceId = config.workspaceId;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Workspace-Id': this.workspaceId,
    };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { message?: string; error?: string })?.message || (data as { error?: string })?.error || response.statusText;
      throw new FusiooApiError(msg, response.status);
    }
    return data as T;
  }
}
