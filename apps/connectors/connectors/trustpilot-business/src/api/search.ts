import type { TrustpilotBusinessClient } from './client';
import type { BusinessUnitSearchResponse, BusinessUnitSummary } from '../types';

export class SearchApi {
  constructor(private readonly client: TrustpilotBusinessClient) {}

  searchBusinessUnits(params: {
    query: string;
    country?: string;
    page?: number;
    perpage?: number;
  }): Promise<BusinessUnitSearchResponse> {
    return this.client.get<BusinessUnitSearchResponse>('/business-units/search', params);
  }

  findBusinessUnit(name: string): Promise<BusinessUnitSummary> {
    return this.client.get<BusinessUnitSummary>('/business-units/find', { name });
  }
}
