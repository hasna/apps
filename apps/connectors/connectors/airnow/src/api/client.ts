import type { AirNowConfig } from '../types';
import { AirNowApiError } from '../types';

export class AirNowClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://www.airnowapi.org/aq';

  constructor(config: AirNowConfig) {
    if (!config.apiKey) throw new Error('AirNow apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('format', 'application/json');
    url.searchParams.append('API_KEY', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AirNowApiError(text || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
