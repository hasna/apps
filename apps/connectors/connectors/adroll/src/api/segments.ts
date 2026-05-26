import type { ConnectorClient } from './client';
import type { Segment, ListParams, PaginatedResponse } from '../types';

export class SegmentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(advertisableEid: string, params?: ListParams): Promise<PaginatedResponse<Segment>> {
    return this.client.get<PaginatedResponse<Segment>>('/api/v1/advertisable/get_segments', {
      advertisable: advertisableEid,
      ...params,
    });
  }

  async get(eid: string): Promise<Segment> {
    const resp = await this.client.get<{ results: Segment }>('/api/v1/segment/get', {
      segment: eid,
    });
    return resp.results;
  }
}
