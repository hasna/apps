import type { ListQueryParams } from '../types';
import type { StandardSignalClient } from './client';

export class PerformanceApi {
  constructor(private readonly client: StandardSignalClient) {}

  async get(params?: ListQueryParams): Promise<unknown> {
    return this.client.request('/performance', { params });
  }
}
