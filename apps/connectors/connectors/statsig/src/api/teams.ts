import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

/** @see https://docs.statsig.com/console-api/teams */
export class TeamsApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/teams');
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/teams', body);
  }
}
