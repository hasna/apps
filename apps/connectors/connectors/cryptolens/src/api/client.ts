import type { CryptolensConfig } from '../types';
import { CryptolensApiError } from '../types';

export class CryptolensClient {
  private readonly token: string;
  private readonly baseUrl = 'https://app.cryptolens.io/api';

  constructor(config: CryptolensConfig) {
    if (!config.token) throw new Error('Cryptolens token is required');
    this.token = config.token;
  }

  async request<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const body = new URLSearchParams();
    body.append('token', this.token);
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) body.append(k, String(v)); });
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const data = await response.json().catch(() => ({})) as { result?: number; message?: string; [key: string]: unknown };
    if (!response.ok || (data.result !== undefined && data.result !== 0)) throw new CryptolensApiError(data.message || response.statusText, response.status);
    return data as T;
  }
}
