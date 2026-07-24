import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

/** @see https://docs.statsig.com/console-api/metrics */
export class MetricsApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/metrics');
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/metrics/${encodeId(id)}`);
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/metrics', body);
  }
}
