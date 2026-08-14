import type { DHLConfig } from '../types';
import { DHLApiError } from '../types';

export class DHLClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api-eu.dhl.com';

  constructor(config: DHLConfig) {
    if (!config.apiKey) throw new Error('DHL apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'DHL-API-Key': this.apiKey, Accept: 'application/json' };
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new DHLApiError((data as { detail?: string })?.detail || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = { 'DHL-API-Key': this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' };
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new DHLApiError((data as { detail?: string })?.detail || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
