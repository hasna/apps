import type { MatrixConfig } from '../types';
import { MatrixApiError } from '../types';

export class MatrixClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(config: MatrixConfig) {
    if (!config.homeserver || !config.accessToken) throw new Error('Matrix homeserver and accessToken are required');
    this.accessToken = config.accessToken;
    this.baseUrl = `${config.homeserver.replace(/\/$/, '')}/_matrix/client/v3`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = data as { error?: string; errcode?: string };
      throw new MatrixApiError(err.error || response.statusText, response.status, err.errcode);
    }
    return data as T;
  }
}
