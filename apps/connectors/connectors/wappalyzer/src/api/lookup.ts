import type { LookupParams, LookupResult } from '../types';
import type { ConnectorClient } from './client';

export class LookupApi {
  constructor(private readonly client: ConnectorClient) {}

  async lookup(params: LookupParams): Promise<LookupResult[]> {
    if (!params.urls?.length) {
      throw new Error('At least one URL is required');
    }

    if (params.urls.length > 10) {
      throw new Error('Maximum 10 URLs per request');
    }

    return this.client.get<LookupResult[]>('/lookup/', {
      urls: params.urls.join(','),
      live: params.live,
      recursive: params.recursive,
      callback_url: params.callback_url,
      sets: params.sets,
      denoise: params.denoise,
      min_age: params.min_age,
      max_age: params.max_age,
      squash: params.squash,
      debug_email: params.debug_email,
    });
  }
}
