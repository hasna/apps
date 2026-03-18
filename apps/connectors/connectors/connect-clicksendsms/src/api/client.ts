import type { ClickSendConfig } from '../types';
import { ClickSendApiError } from '../types';

export class ClickSendClient {
  private readonly authHeader: string;
  private readonly baseUrl = 'https://rest.clicksend.com/v3';

  constructor(config: ClickSendConfig) {
    if (!config.username || !config.apiKey) throw new Error('ClickSend username and apiKey are required');
    this.authHeader = `Basic ${btoa(`${config.username}:${config.apiKey}`)}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({})) as { http_code?: number; response_code?: string; response_msg?: string; data?: unknown };
    if (!response.ok || (data.http_code && data.http_code >= 400)) throw new ClickSendApiError(data.response_msg || response.statusText, response.status);
    return (data.data ?? data) as T;
  }
}
