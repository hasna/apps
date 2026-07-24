import type { ValenceClient } from './client';
import type { ListParams } from '../types';

export class ArbitrageApi {
  constructor(private readonly client: ValenceClient) {}

  async listOpportunities(params?: ListParams): Promise<unknown> {
    return this.client.request('/arbitrage/opportunities', { params });
  }
}
