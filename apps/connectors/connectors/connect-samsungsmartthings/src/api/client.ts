import type { SmartThingsConfig } from '../types';
import { SmartThingsApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.smartthings.com/v1';

export class SmartThingsClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: SmartThingsConfig) {
    if (!config.token) throw new Error('SmartThings PAT token is required');
    this.token = config.token;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> | unknown[]; params?: Record<string, string | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.append(k, v); });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 200 && method === 'POST' && path.includes('/commands')) {
      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { message?: string; error?: { details?: string } })?.message
        || (data as { error?: { details?: string } })?.error?.details
        || response.statusText;
      throw new SmartThingsApiError(msg, response.status);
    }
    return data as T;
  }

  getTokenPreview(): string { return `${this.token.substring(0, 8)}...`; }
}
