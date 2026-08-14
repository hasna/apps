import type { SugarRecord } from '../types';
import type { ConnectorClient } from './client';

export class UserApi {
  constructor(private readonly client: ConnectorClient) {}

  async getCurrentUser(): Promise<SugarRecord> {
    return this.client.get<SugarRecord>('/me');
  }

  async ping(): Promise<unknown> {
    return this.client.get('/ping');
  }
}
