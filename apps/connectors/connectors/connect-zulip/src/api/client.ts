import type { ZulipConfig } from '../types';
import { ZulipApiError } from '../types';
export class ZulipClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;
  constructor(config: ZulipConfig) {
    if (!config.email || !config.apiKey || !config.serverUrl) throw new Error('Zulip email, apiKey, and serverUrl are required');
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiKey}`).toString('base64')}`;
    this.baseUrl = `${config.serverUrl.replace(/\/$/, '')}/api/v1`;
  }
  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params && method === 'GET') Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const form = new URLSearchParams();
      Object.entries(body).forEach(([k, v]) => { if (v !== undefined) form.append(k, typeof v === 'string' ? v : JSON.stringify(v)); });
      fetchOptions.body = form.toString();
    }
    const response = await fetch(url.toString(), fetchOptions);
    const data = await response.json().catch(() => ({}));
    if ((data as { result?: string }).result === 'error') throw new ZulipApiError((data as { msg?: string }).msg || 'Zulip error', response.status);
    if (!response.ok) throw new ZulipApiError(response.statusText, response.status);
    return data as T;
  }
}
