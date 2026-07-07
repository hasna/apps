import type { ConnectorClient, RequestOptions } from './client';

/**
 * Raw request escape hatch for undocumented or preview Issuing endpoints.
 */
export class RawApi {
  constructor(private readonly client: ConnectorClient) {}

  async request<T>(path: string, options?: RequestOptions): Promise<T> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return this.client.request<T>(normalizedPath, options ?? {});
  }
}
