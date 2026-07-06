import type { ConnectorClient } from './client';
import type { AttractionsSearchParams, AttractionsSearchResponse, DiscoveryAttraction } from '../types';

function toQueryParams(params: AttractionsSearchParams): Record<string, string | number | boolean | undefined> {
  return { ...params };
}

export class AttractionsApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(params?: AttractionsSearchParams): Promise<AttractionsSearchResponse> {
    return this.client.get<AttractionsSearchResponse>('/attractions.json', toQueryParams(params ?? {}));
  }

  async get(id: string): Promise<DiscoveryAttraction> {
    const encodedId = encodeURIComponent(id);
    return this.client.get<DiscoveryAttraction>(`/attractions/${encodedId}.json`);
  }
}
