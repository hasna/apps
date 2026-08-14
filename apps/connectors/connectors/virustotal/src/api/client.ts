import type { VirusTotalConfig } from '../types';
import { VirusTotalApiError } from '../types';

export class VirusTotalClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://www.virustotal.com/api/v3';

  constructor(config: VirusTotalConfig) {
    if (!config.apiKey) throw new Error('VirusTotal apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> | string; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'x-apikey': this.apiKey };
    if (typeof body !== 'string') headers['Content-Type'] = 'application/json';
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = (data as { error?: { message?: string } });
      throw new VirusTotalApiError(err.error?.message || response.statusText, response.status);
    }
    return data as T;
  }
}
