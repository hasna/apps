import type { PlivoConfig } from '../types';
import { PlivoApiError } from '../types';

export class PlivoClient {
  private readonly authId: string;
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: PlivoConfig) {
    if (!config.authId || !config.authToken) throw new Error('Plivo auth_id and auth_token are required');
    this.authId = config.authId;
    this.baseUrl = (config.baseUrl || 'https://api.plivo.com/v1').replace(/\/$/, '');
    this.authHeader = `Basic ${Buffer.from(`${config.authId}:${config.authToken}`).toString('base64')}`;
  }

  private get accountBase() {
    return `${this.baseUrl}/Account/${this.authId}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.accountBase}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.append(k, String(v));
      });
    }
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
    };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { error?: string; message?: string })?.error || (data as { message?: string })?.message || response.statusText;
      throw new PlivoApiError(msg, response.status);
    }
    return data as T;
  }

  getAuthIdPreview(): string {
    return `${this.authId.substring(0, 8)}...`;
  }
}
