import type { TisaneLabsConfig } from '../types';
import { TisaneLabsApiError } from '../types';

export class TisaneLabsClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.tisane.ai';

  constructor(config: TisaneLabsConfig) {
    if (!config.apiKey) throw new Error('Tisane Labs apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = { 'Ocp-Apim-Subscription-Key': this.apiKey, 'Content-Type': 'application/json' };
    const response = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new TisaneLabsApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
