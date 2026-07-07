import type { RawRequestParams } from '../types';
import type { ConnectorClient } from './client';

export class RawApi {
  constructor(private readonly client: ConnectorClient) {}

  request<T = unknown>(params: RawRequestParams): Promise<T> {
    const { method = 'GET', path, query, body, headers } = params;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }
}
