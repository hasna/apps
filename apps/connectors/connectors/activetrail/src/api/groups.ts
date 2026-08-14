import type { ConnectorClient } from './client';
import type { Group, GroupCreateParams, ListParams } from '../types';

export class GroupsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<Group[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<Group[]>('/groups', queryParams);
  }

  async get(groupId: number): Promise<Group> {
    return this.client.get<Group>(`/groups/${groupId}`);
  }

  async create(params: GroupCreateParams): Promise<Group> {
    return this.client.post<Group>('/groups', params);
  }

  async update(groupId: number, params: Partial<GroupCreateParams>): Promise<void> {
    await this.client.put(`/groups/${groupId}`, params);
  }

  async delete(groupId: number): Promise<void> {
    await this.client.delete(`/groups/${groupId}`);
  }

  async getMembers(groupId: number, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<unknown>(`/groups/${groupId}/members`, queryParams);
  }

  async addMember(groupId: number, contactId: number): Promise<unknown> {
    return this.client.post<unknown>(`/groups/${groupId}/members`, { ContactId: contactId });
  }

  async removeMember(groupId: number, memberId: number): Promise<void> {
    await this.client.delete(`/groups/${groupId}/members/${memberId}`);
  }
}
