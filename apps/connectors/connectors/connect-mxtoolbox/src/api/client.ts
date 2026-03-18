import type { MXToolboxConfig } from '../types';
import { MXToolboxApiError } from '../types';

export class MXToolboxClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://mxtoolbox.com/api/v1';

  constructor(config: MXToolboxConfig) {
    if (!config.apiKey) throw new Error('MXToolbox apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.apiKey };
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new MXToolboxApiError((data as { Message?: string })?.Message || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
