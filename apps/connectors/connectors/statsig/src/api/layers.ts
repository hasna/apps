import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

/** @see https://docs.statsig.com/console-api/layers */
export class LayersApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/layers');
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/layers', body);
  }
}
