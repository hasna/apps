import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

/** @see https://docs.statsig.com/console-api/autotunes */
export class AutotunesApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/autotunes');
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/autotunes', body);
  }
}
