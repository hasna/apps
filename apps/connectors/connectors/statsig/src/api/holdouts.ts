import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

/** @see https://docs.statsig.com/console-api/holdouts */
export class HoldoutsApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/holdouts');
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/holdouts', body);
  }

  delete(id: string): Promise<unknown> {
    return this.client.delete(`/holdouts/${encodeId(id)}`);
  }
}
