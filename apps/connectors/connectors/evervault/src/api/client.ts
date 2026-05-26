import type { EvervaultConfig } from '../types';
import { EvervaultApiError } from '../types';

export class EvervaultClient {
  private readonly authHeader: string;
  private readonly baseUrl = 'https://api.evervault.com';

  constructor(config: EvervaultConfig) {
    if (!config.appId || !config.apiKey) throw new Error('Evervault appId and apiKey are required');
    this.authHeader = `Basic ${btoa(`${config.appId}:${config.apiKey}`)}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new EvervaultApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
