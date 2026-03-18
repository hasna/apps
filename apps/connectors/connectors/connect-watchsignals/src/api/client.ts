import type { WatchSignalsConfig } from '../types';
import { WatchSignalsApiError } from '../types';

export class WatchSignalsClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.watchsignals.com/v1';

  constructor(config: WatchSignalsConfig) {
    if (!config.apiKey) throw new Error('WatchSignals apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-API-Key': this.apiKey, Accept: 'application/json' };
    const response = await fetch(url.toString(), { headers });
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new WatchSignalsApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
