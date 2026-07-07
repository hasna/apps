import type { StainlessClient } from './client';
import type { Org, OrgListResponse } from '../types';

/**
 * Orgs API — list and retrieve organizations.
 * https://www.stainless.com/docs/api (/v0/orgs)
 */
export class OrgsApi {
  constructor(private readonly client: StainlessClient) {}

  async list(): Promise<OrgListResponse> {
    return this.client.get<OrgListResponse>('/orgs');
  }

  async retrieve(org: string): Promise<Org> {
    return this.client.get<Org>(`/orgs/${encodeURIComponent(org)}`);
  }
}
