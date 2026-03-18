import type { DropcontactConfig } from '../types';
import { DropcontactApiError } from '../types';
const DEFAULT_BASE_URL = 'https://api.dropcontact.io/v1';
export class DropcontactClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  constructor(config: DropcontactConfig) {
    if (!config.apiKey) throw new Error('Dropcontact API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }
  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const headers: Record<string, string> = { 'X-Access-Token': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && method === 'POST') fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new DropcontactApiError((data as { reason?: string })?.reason || response.statusText, response.status);
    return data as T;
  }
}
