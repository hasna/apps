import type { RiteKitConfig } from '../types';
import { RiteKitApiError } from '../types';

export class RiteKitClient {
  private readonly clientId: string;
  private readonly baseUrl = 'https://api.ritekit.com/v1';

  constructor(config: RiteKitConfig) {
    if (!config.clientId) throw new Error('RiteKit clientId is required');
    this.clientId = config.clientId;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('client_id', this.clientId);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RiteKitApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
