import type { SpotifyAdsClient } from './client';
import type { Business, BusinessesResponse } from '../types';

export class BusinessesApi {
  constructor(private readonly client: SpotifyAdsClient) {}

  async list(): Promise<BusinessesResponse> {
    return this.client.get<BusinessesResponse>('/businesses');
  }

  async get(businessId: string): Promise<Business> {
    return this.client.get<Business>(`/businesses/${businessId}`);
  }
}
