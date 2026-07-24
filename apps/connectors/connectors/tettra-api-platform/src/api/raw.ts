import type { ConnectorClient } from './client';
import type { RawRequestOptions } from '../types';

export class RawApi {
  constructor(private readonly client: ConnectorClient) {}

  async request<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body, headers } = options;
    return this.client.request<T>(path, {
      method,
      params,
      body: body as Record<string, unknown> | undefined,
      headers,
    });
  }
}
