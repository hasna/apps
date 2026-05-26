import type { ConnectorClient } from './client';
import type { Group, GroupCreateParams } from '../types';

export class GroupsApi {
  constructor(private readonly client: ConnectorClient) {}

  async listWithDomains(params?: { include_subaccounts?: boolean }): Promise<unknown> {
    return this.client.get('/overview/group_domains', params as Record<string, string | number | boolean | undefined>);
  }

  async create(params: GroupCreateParams): Promise<Group> {
    return this.client.post<Group>('/group/', params);
  }

  async update(id: number, params: { name?: string }): Promise<Group> {
    return this.client.put<Group>(`/group/${id}`, params);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/group/${id}`);
  }
}
