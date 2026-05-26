import type { ConnectorClient } from './client';
import type { Domain, DomainCreateParams, DomainUpdateParams, ListParams } from '../types';

export class DomainsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<Domain[]> {
    return this.client.get<Domain[]>('/domains/', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: number, params?: { fields?: string }): Promise<Domain> {
    return this.client.get<Domain>(`/domains/${id}/`, params as Record<string, string | number | boolean | undefined>);
  }

  async create(params: DomainCreateParams): Promise<Domain> {
    return this.client.post<Domain>('/domain/', params);
  }

  async update(id: number, params: DomainUpdateParams): Promise<Domain> {
    return this.client.put<Domain>(`/domain/${id}`, params);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/domain/${id}`);
  }
}
