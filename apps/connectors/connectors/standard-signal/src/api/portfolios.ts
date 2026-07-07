import type { ListQueryParams } from '../types';
import type { StandardSignalClient } from './client';

export class PortfoliosApi {
  constructor(private readonly client: StandardSignalClient) {}

  async list(params?: ListQueryParams): Promise<unknown> {
    return this.client.request('/portfolios', { params });
  }

  async get(portfolioId: string): Promise<unknown> {
    return this.client.request(`/portfolios/${encodeURIComponent(portfolioId)}`);
  }
}
