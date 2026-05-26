import type { ConnectorClient } from './client';
import type {
  GroupResponse,
  GroupListResponse,
  GroupCreateParams,
  GroupUpdateParams,
  ListParams,
} from '../types';

export class GroupsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<GroupListResponse> {
    return this.client.get<GroupListResponse>('/issuer/all_groups', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: number): Promise<GroupResponse> {
    return this.client.get<GroupResponse>(`/issuer/groups/${id}`);
  }

  async create(params: GroupCreateParams): Promise<GroupResponse> {
    return this.client.post<GroupResponse>('/issuer/groups', params);
  }

  async update(id: number, params: GroupUpdateParams): Promise<GroupResponse> {
    return this.client.put<GroupResponse>(`/issuer/groups/${id}`, params);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/issuer/groups/${id}`);
  }
}
