import type { ConnectorClient } from './client';
import type { Organization, PaginatedResponse } from '../types';

export class OrganizationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<PaginatedResponse<Organization>> {
    return this.client.get<PaginatedResponse<Organization>>('/api/v1/organization/get_all');
  }

  async get(eid: string): Promise<Organization> {
    const resp = await this.client.get<{ results: Organization }>('/api/v1/organization/get', {
      organization: eid,
    });
    return resp.results;
  }
}
