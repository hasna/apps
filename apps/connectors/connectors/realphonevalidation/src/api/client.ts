import type { RealPhoneValidationConfig } from '../types';
import { RealPhoneValidationApiError } from '../types';

export class RealPhoneValidationClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.realphonevalidation.com';

  constructor(config: RealPhoneValidationConfig) {
    if (!config.apiKey) throw new Error('Real Phone Validation apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('token', this.apiKey);
    url.searchParams.append('output', 'json');
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RealPhoneValidationApiError((data as { error_text?: string })?.error_text || response.statusText, response.status);
    return data as T;
  }
}
