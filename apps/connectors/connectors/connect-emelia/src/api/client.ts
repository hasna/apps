import type { EmeliaConfig } from '../types';
import { EmeliaApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.emelia.io';

export class EmeliaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: EmeliaConfig) {
    if (!config.apiKey) throw new Error('Emelia API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { message?: string; error?: string })?.message || (data as { error?: string })?.error || response.statusText;
      throw new EmeliaApiError(msg, response.status);
    }
    return data as T;
  }
}
