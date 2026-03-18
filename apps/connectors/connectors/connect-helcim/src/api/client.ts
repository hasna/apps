import type { HelcimConfig } from '../types';
import { HelcimApiError } from '../types';
const DEFAULT_BASE_URL = 'https://api.helcim.com/v2';
export class HelcimClient {
  private readonly apiToken: string; private readonly baseUrl: string;
  constructor(config: HelcimConfig) {
    if (!config.apiToken) throw new Error('Helcim API token is required');
    this.apiToken = config.apiToken; this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }
  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'api-token': this.apiToken, 'Content-Type': 'application/json', Accept: 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new HelcimApiError((data as { errors?: string[] })?.errors?.[0] || response.statusText, response.status);
    return data as T;
  }
}
