import type { WistiaClient } from './client';
import type { WistiaAccount } from '../types';

export class AccountApi {
  constructor(private readonly client: WistiaClient) {}

  async get(): Promise<WistiaAccount> {
    return this.client.get<WistiaAccount>('/v1/account.json');
  }

  async getStats(): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>('/v1/stats/account.json');
  }
}
