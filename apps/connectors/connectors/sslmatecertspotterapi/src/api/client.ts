import type { CertSpotterConfig } from '../types';
import { CertSpotterApiError } from '../types';

export class CertSpotterClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.certspotter.com/v1';

  constructor(config: CertSpotterConfig) {
    if (!config.apiKey) throw new Error('CertSpotter apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new CertSpotterApiError((data as { message?: string })?.message || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
