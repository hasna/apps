import type { ValenceClient } from './client';
import type { ListParams } from '../types';

export class PositionsApi {
  constructor(private readonly client: ValenceClient) {}

  async getPositions(params?: ListParams): Promise<unknown> {
    return this.client.request('/positions', { params });
  }
}
