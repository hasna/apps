import type { ConnectorClient } from './client';
import type { RawRequestParams } from '../types';

export class RawApi {
  constructor(private readonly client: ConnectorClient) {}

  async request(params: RawRequestParams): Promise<unknown> {
    const { method = 'GET', path, query, body } = params;
    if (!path) {
      throw new Error('path is required for raw requests');
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    return this.client.request(normalizedPath, {
      method,
      params: query,
      body,
    });
  }
}
