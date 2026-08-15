import type { ConnectorClient } from './client';

export class ThreadsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(boxKey: string): Promise<unknown[]> {
    return this.client.get<unknown[]>(`/boxes/${encodeURIComponent(boxKey)}/threads`);
  }
}
