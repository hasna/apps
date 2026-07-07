import type { DateRangeOptions, PaginationOptions } from '../types';
import type { UserpilotClient } from './client';

export class FeatureTagsApi {
  constructor(private readonly client: UserpilotClient) {}

  list(options: PaginationOptions = {}): Promise<unknown> {
    return this.client.get('/feature-tags', options);
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/feature-tags/${encodeURIComponent(id)}`);
  }

  analytics(id: string, options: DateRangeOptions = {}): Promise<unknown> {
    return this.client.get(`/feature-tags/${encodeURIComponent(id)}/analytics`, options);
  }
}
