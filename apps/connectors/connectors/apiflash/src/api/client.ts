import type { ApiFlashConfig } from '../types';
import { ApiFlashApiError } from '../types';

export class ApiFlashClient {
  private readonly accessKey: string;
  private readonly baseUrl = 'https://api.apiflash.com/v1';

  constructor(config: ApiFlashConfig) {
    if (!config.accessKey) throw new Error('ApiFlash accessKey is required');
    this.accessKey = config.accessKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('access_key', this.accessKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ApiFlashApiError((data as { error_message?: string })?.error_message || response.statusText, response.status);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return (await response.json()) as T;
    return { url: url.toString() } as T;
  }

  getAccessKey(): string { return this.accessKey; }
}
