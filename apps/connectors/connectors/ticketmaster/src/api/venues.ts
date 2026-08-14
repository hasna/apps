import type { ConnectorClient } from './client';
import type { VenuesSearchParams, VenuesSearchResponse, DiscoveryVenue } from '../types';

function toQueryParams(params: VenuesSearchParams): Record<string, string | number | boolean | undefined> {
  return { ...params };
}

export class VenuesApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(params?: VenuesSearchParams): Promise<VenuesSearchResponse> {
    return this.client.get<VenuesSearchResponse>('/venues.json', toQueryParams(params ?? {}));
  }

  async get(id: string): Promise<DiscoveryVenue> {
    const encodedId = encodeURIComponent(id);
    return this.client.get<DiscoveryVenue>(`/venues/${encodedId}.json`);
  }
}
