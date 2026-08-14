import type { ConnectorClient, RequestOptions } from './client';

export class RawApi {
  constructor(private readonly client: ConnectorClient) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.client.request<T>(path, options);
  }
}
