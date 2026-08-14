import type { ValenceClient } from './client';
import type { ListParams } from '../types';

export class BalancesApi {
  constructor(private readonly client: ValenceClient) {}

  async getBalances(params?: ListParams): Promise<unknown> {
    return this.client.request('/balances', { params });
  }
}
