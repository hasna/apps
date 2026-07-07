import type { ListQueryParams } from '../types';
import type { StandardSignalClient } from './client';

export class StrategiesApi {
  constructor(private readonly client: StandardSignalClient) {}

  async list(params?: ListQueryParams): Promise<unknown> {
    return this.client.request('/strategies', { params });
  }
}
