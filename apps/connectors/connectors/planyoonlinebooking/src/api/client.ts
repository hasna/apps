import type { PlanyoConfig } from '../types';
import { PlanyoApiError } from '../types';

export class PlanyoClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://www.planyo.com/rest';

  constructor(config: PlanyoConfig) {
    if (!config.apiKey) throw new Error('Planyo apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(method: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(this.baseUrl);
    url.searchParams.append('api_key', this.apiKey);
    url.searchParams.append('method', method);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({})) as { response_code?: number; response_message?: string; [key: string]: unknown };
    if (!response.ok || (data.response_code !== undefined && data.response_code !== 0)) throw new PlanyoApiError(data.response_message || response.statusText, response.status);
    return data as T;
  }
}
