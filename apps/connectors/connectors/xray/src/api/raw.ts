import type { ConnectorClient } from './client';
import type { RawRequestParams } from '../types';

export class RawApi {
  constructor(private readonly client: ConnectorClient) {}

  async request<T = unknown>(params: RawRequestParams): Promise<T> {
    const { method = 'GET', path, query, body, headers } = params;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }
}
