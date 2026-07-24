import type { ConnectorClient } from './client';
import type { ListParams } from '../types';

export class EnvironmentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    return this.client.get('/environments', params);
  }
}
