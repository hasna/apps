import type { RelatedListParams, SugarRecord } from '../types';
import type { ConnectorClient } from './client';

function encodeModule(module: string): string {
  return encodeURIComponent(module);
}

export class RelatedApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(
    module: string,
    id: string,
    link: string,
    data: Record<string, unknown>
  ): Promise<SugarRecord> {
    return this.client.post<SugarRecord>(
      `/${encodeModule(module)}/${encodeURIComponent(id)}/link/${encodeURIComponent(link)}`,
      data
    );
  }

  async list(
    module: string,
    id: string,
    link: string,
    options: RelatedListParams = {}
  ): Promise<unknown> {
    return this.client.get(
      `/${encodeModule(module)}/${encodeURIComponent(id)}/link/${encodeURIComponent(link)}`,
      {
        fields: options.fields?.join(','),
        max_num: options.maxNum,
        offset: options.offset,
      }
    );
  }

  async unlink(module: string, id: string, link: string, relatedId: string): Promise<unknown> {
    return this.client.delete(
      `/${encodeModule(module)}/${encodeURIComponent(id)}/link/${encodeURIComponent(link)}/${encodeURIComponent(relatedId)}`
    );
  }
}
