import type { ConnectorClient } from './client';
import type { Organization, OrganizationCreateParams, ListParams, PaginatedResponse } from '../types';

export class OrganizationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<PaginatedResponse<Organization>> {
    return this.client.get<PaginatedResponse<Organization>>('/v2/companies', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: number, fieldIds?: number[]): Promise<Organization> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fieldIds?.length) {
      params.fieldIds = fieldIds.join(',');
    }
    return this.client.get<Organization>(`/v2/companies/${id}`, params);
  }

  async create(data: OrganizationCreateParams): Promise<Organization> {
    return this.client.post<Organization>('/v2/companies', data);
  }

  async update(id: number, data: Partial<OrganizationCreateParams>): Promise<Organization> {
    return this.client.patch<Organization>(`/v2/companies/${id}`, data);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/v2/companies/${id}`);
  }
}
