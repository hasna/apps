import type { OuraConfig } from '../types';
import { OuraApiError } from '../types';

export class OuraClient {
  private readonly token: string;
  private readonly baseUrl = 'https://api.ouraring.com/v2';

  constructor(config: OuraConfig) {
    if (!config.token) throw new Error('Oura token is required');
    this.token = config.token;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new OuraApiError((data as { detail?: string })?.detail || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
