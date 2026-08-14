import type { DropcontactConfig } from '../types';
import { DropcontactApiError } from '../types';

export class DropcontactClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.dropcontact.io';

  constructor(config: DropcontactConfig) {
    if (!config.apiKey) throw new Error('Dropcontact apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { 'X-Access-Token': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url, fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new DropcontactApiError((data as { reason?: string })?.reason || response.statusText, response.status);
    return data as T;
  }
}
