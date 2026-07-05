import type { UserpilotClient } from './client';

export class ResourceCentersApi {
  constructor(private readonly client: UserpilotClient) {}

  list(): Promise<unknown> {
    return this.client.get('/resource-centers');
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/resource-centers/${encodeURIComponent(id)}`);
  }
}
