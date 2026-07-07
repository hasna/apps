import type { ConnectorClient, RequestOptions } from './client';

/**
 * Raw request helper for undocumented Stripe Connect endpoints.
 */
export class RawRequestApi {
  constructor(private readonly client: ConnectorClient) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.client.request<T>(path.startsWith('/') ? path : `/${path}`, options);
  }
}
