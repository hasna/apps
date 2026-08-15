import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

/** @see https://docs.statsig.com/console-api/events */
export class EventsApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/events');
  }

  logCustom(body: JsonRecord): Promise<unknown> {
    return this.client.post('/events/custom', body);
  }

  logExposure(body: JsonRecord): Promise<unknown> {
    return this.client.post('/events/exposure', body);
  }
}
