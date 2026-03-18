import type { TextmagicConfig } from '../types';
import { TextmagicApiError } from '../types';

const DEFAULT_BASE_URL = 'https://rest.textmagic.com/api/v2';

export class TextmagicClient {
  private readonly username: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TextmagicConfig) {
    if (!config.username || !config.apiKey) throw new Error('Textmagic username and apiKey are required');
    this.username = config.username;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });

    const headers: Record<string, string> = {
      'X-TM-Username': this.username,
      'X-TM-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { message?: string; errors?: Record<string, string[]> })?.message || response.statusText;
      throw new TextmagicApiError(msg, response.status);
    }
    return data as T;
  }
}
