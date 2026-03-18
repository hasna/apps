import type { ServiceNowConfig } from '../types';
import { ServiceNowApiError } from '../types';

export class ServiceNowClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: ServiceNowConfig) {
    if (!config.instance || !config.username || !config.password) throw new Error('ServiceNow instance, username, and password are required');
    this.authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    this.baseUrl = `https://${config.instance}.service-now.com/api/now`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json', Accept: 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = (data as { error?: { message?: string } });
      throw new ServiceNowApiError(err.error?.message || response.statusText, response.status);
    }
    return data as T;
  }
}
