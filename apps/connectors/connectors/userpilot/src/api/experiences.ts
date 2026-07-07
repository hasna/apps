import type { ExperienceAnalyticsOptions, ListExperiencesOptions } from '../types';
import type { UserpilotClient } from './client';

export class ExperiencesApi {
  constructor(private readonly client: UserpilotClient) {}

  list(options: ListExperiencesOptions = {}): Promise<unknown> {
    return this.client.get('/experiences', options);
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/experiences/${encodeURIComponent(id)}`);
  }

  analytics(id: string, options: ExperienceAnalyticsOptions = {}): Promise<unknown> {
    return this.client.get(`/experiences/${encodeURIComponent(id)}/analytics`, options);
  }
}
