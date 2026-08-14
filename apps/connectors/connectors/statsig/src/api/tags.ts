import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

/** @see https://docs.statsig.com/console-api/tags */
export class TagsApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/tags');
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/tags', body);
  }
}
