import type { ConnectorClient } from './client';
import type { HttpMethod, RawRequestOptions } from '../types';

export class RawApi {
  constructor(private readonly client: ConnectorClient) {}

  async request(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, params, body, headers } = options;
    return this.client.request(path, {
      method: method as HttpMethod,
      params,
      body,
      headers,
    });
  }
}
