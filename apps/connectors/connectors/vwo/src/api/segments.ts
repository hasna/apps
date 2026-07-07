import type { ConnectorClient } from './client';
import type { ListParams, Segment, SegmentCreateParams } from '../types';

export class SegmentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    return this.client.get('/segments', params);
  }

  async get(id: string | number): Promise<Segment> {
    return this.client.get<Segment>(`/segments/${encodeURIComponent(String(id))}`);
  }

  async create(data: SegmentCreateParams): Promise<Segment> {
    return this.client.post<Segment>('/segments', data);
  }

  async update(id: string | number, data: Record<string, unknown>): Promise<Segment> {
    return this.client.patch<Segment>(`/segments/${encodeURIComponent(String(id))}`, data);
  }

  async delete(id: string | number): Promise<unknown> {
    return this.client.delete(`/segments/${encodeURIComponent(String(id))}`);
  }
}
