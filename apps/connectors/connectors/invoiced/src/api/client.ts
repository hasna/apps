import type { InvoicedConfig } from '../types';
import { InvoicedApiError } from '../types';
export class InvoicedClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;
  constructor(config: InvoicedConfig) {
    if (!config.apiKey) throw new Error('Invoiced API key is required');
    this.authHeader = `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`;
    this.baseUrl = config.baseUrl || (config.sandbox ? 'https://api.sandbox.invoiced.com' : 'https://api.invoiced.com');
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
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new InvoicedApiError((data as { message?: string; type?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
