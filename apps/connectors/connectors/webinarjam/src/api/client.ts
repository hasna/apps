import type { WebinarJamConfig } from '../types';
import { WebinarJamApiError } from '../types';

export class WebinarJamClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.webinarjam.com/everwebinar';

  constructor(config: WebinarJamConfig) {
    if (!config.apiKey) throw new Error('WebinarJam apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const body = new URLSearchParams();
    body.append('api_key', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) body.append(k, String(v)); });
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const data = await response.json().catch(() => ({})) as { status?: string; message?: string; [key: string]: unknown };
    if (!response.ok || data.status === 'error') throw new WebinarJamApiError(data.message || response.statusText, response.status);
    return data as T;
  }
}
