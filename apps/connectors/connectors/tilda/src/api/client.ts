import type { TildaConfig } from '../types';
import { TildaApiError } from '../types';

export class TildaClient {
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly baseUrl = 'https://api.tildacdn.info/v1';

  constructor(config: TildaConfig) {
    if (!config.publicKey || !config.secretKey) throw new Error('Tilda publicKey and secretKey are required');
    this.publicKey = config.publicKey;
    this.secretKey = config.secretKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('publickey', this.publicKey);
    url.searchParams.append('secretkey', this.secretKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({})) as { status?: string; result?: unknown; message?: string };
    if (!response.ok || data.status === 'ERROR') throw new TildaApiError(data.message || response.statusText, response.status);
    return (data.result ?? data) as T;
  }
}
