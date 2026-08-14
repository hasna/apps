import type { YOURLSConfig } from '../types';
import { YOURLSApiError } from '../types';

// YOURLS is self-hosted — all requests go to the user's YOURLS instance
export class YOURLSClient {
  private readonly apiUrl: string;
  private readonly signature: string;

  constructor(config: YOURLSConfig) {
    if (!config.apiUrl || !config.signatureToken) throw new Error('YOURLS apiUrl and signatureToken are required');
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.signature = config.signatureToken;
  }

  async request<T>(action: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(this.apiUrl);
    url.searchParams.append('signature', this.signature);
    url.searchParams.append('format', 'json');
    url.searchParams.append('action', action);
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });

    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new YOURLSApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
