// Gender API Connector — Gender detection from names
import { GenderAPIClient } from './client';
import type { GenderAPIConfig, GAResult } from '../types';
export { GenderAPIClient } from './client';

export class GenderAPI {
  private readonly client: GenderAPIClient;
  constructor(config: GenderAPIConfig) { this.client = new GenderAPIClient(config); }
  static fromEnv(): GenderAPI {
    const apiKey = process.env.GENDERAPI_API_KEY;
    if (!apiKey) throw new Error('GENDERAPI_API_KEY is required');
    return new GenderAPI({ apiKey });
  }

  async detect(name: string, options?: { country?: string; language?: string }): Promise<GAResult> {
    return this.client.request<GAResult>('/get', { name, country: options?.country, language: options?.language });
  }

  async detectByEmail(email: string): Promise<GAResult> {
    return this.client.request<GAResult>('/get', { email });
  }

  async detectBatch(names: string[], country?: string): Promise<GAResult[]> {
    return this.client.request<GAResult[]>('/get', { name: names.join(';'), country });
  }

  async getStats(): Promise<{ is_limit_reached: boolean; limit: number; remaining_requests: number }> {
    return this.client.request('/get-stats');
  }

  getClient(): GenderAPIClient { return this.client; }
}
