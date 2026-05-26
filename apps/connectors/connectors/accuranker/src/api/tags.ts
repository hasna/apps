import type { ConnectorClient } from './client';
import type { Tag, ListParams } from '../types';

export class TagsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(domainId: number, params?: ListParams): Promise<Tag[]> {
    return this.client.get<Tag[]>(`/domains/${domainId}/tags/`, params as Record<string, string | number | boolean | undefined>);
  }
}
