import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

/** @see https://docs.statsig.com/console-api/segments */
export class SegmentsApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/segments');
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/segments', body);
  }

  addIds(id: string, ids: string[]): Promise<unknown> {
    return this.client.post(`/segments/${encodeId(id)}/ids`, { ids });
  }

  removeIds(id: string, ids: string[]): Promise<unknown> {
    return this.client.request(`/segments/${encodeId(id)}/ids`, {
      method: 'DELETE',
      body: { ids },
    });
  }
}
