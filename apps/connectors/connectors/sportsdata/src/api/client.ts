import type { SportsDataConfig } from '../types';
import { SportsDataApiError } from '../types';

export class SportsDataClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.sportsdata.io/v3';

  constructor(config: SportsDataConfig) {
    if (!config.apiKey) throw new Error('SportsData apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(sport: string, path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}/${sport}/scores/json${path}`);
    url.searchParams.append('key', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    if (!response.ok) throw new SportsDataApiError(response.statusText, response.status);
    return (await response.json()) as T;
  }
}
