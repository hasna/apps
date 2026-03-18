import type { CustomerIOConfig } from '../types';
import { CustomerIOApiError } from '../types';

export class CustomerIOClient {
  private readonly trackAuth: string;
  private readonly appAuth?: string;
  private readonly trackUrl = 'https://track.customer.io/api/v1';
  private readonly appUrl = 'https://beta-api.customer.io/v1/api';

  constructor(config: CustomerIOConfig) {
    if (!config.siteId || !config.apiKey) throw new Error('Customer.io siteId and apiKey are required');
    this.trackAuth = `Basic ${btoa(`${config.siteId}:${config.apiKey}`)}`;
    if (config.appApiKey) this.appAuth = `Bearer ${config.appApiKey}`;
  }

  async trackRequest<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const headers: Record<string, string> = { Authorization: this.trackAuth, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.trackUrl}${path}`, fetchOptions);
    if (response.status === 200 || response.status === 204) { const text = await response.text(); return (text ? JSON.parse(text) : {}) as T; }
    const data = await response.json().catch(() => ({}));
    throw new CustomerIOApiError((data as { meta?: { error?: string } })?.meta?.error || response.statusText, response.status);
  }

  async appRequest<T>(path: string, options: { method?: string; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    if (!this.appAuth) throw new Error('Customer.io appApiKey required for app API');
    const { method = 'GET', params } = options;
    const url = new URL(`${this.appUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.appAuth, 'Content-Type': 'application/json' };
    const response = await fetch(url.toString(), { method, headers });
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CustomerIOApiError((data as { meta?: { error?: string } })?.meta?.error || response.statusText, response.status);
    return data as T;
  }
}
