import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';
import type { ListParams, SiteListResponse, SiteResponse } from '../types';

export class SitesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<SiteListResponse> {
    return this.client.get<SiteListResponse>('/sites', params);
  }

  async get(siteId: string): Promise<SiteResponse> {
    return this.client.get<SiteResponse>(`/sites/${encodePathSegment(siteId)}`);
  }
}
