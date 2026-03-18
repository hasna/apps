// Microsoft Entra ID Connector — Identity and access management
import { MSEntraIDClient } from './client';
import type { MSEntraIDConfig, MEUser, MEUserList, MEGroup, MEGroupList, MEApp } from '../types';
export { MSEntraIDClient } from './client';

export class MSEntraID {
  private readonly client: MSEntraIDClient;
  constructor(config: MSEntraIDConfig) { this.client = new MSEntraIDClient(config); }
  static fromEnv(): MSEntraID {
    const token = process.env.ENTRAID_TOKEN;
    if (!token) throw new Error('ENTRAID_TOKEN is required');
    return new MSEntraID({ token });
  }

  async listUsers(options?: { $top?: number; $filter?: string; $select?: string }): Promise<MEUserList> {
    return this.client.request<MEUserList>('/users', { params: { $top: options?.$top, $filter: options?.$filter, $select: options?.$select } });
  }
  async getUser(userId: string): Promise<MEUser> { return this.client.request<MEUser>(`/users/${userId}`); }
  async createUser(data: { displayName: string; mailNickname: string; userPrincipalName: string; passwordProfile: { password: string }; accountEnabled: boolean }): Promise<MEUser> {
    return this.client.request<MEUser>('/users', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteUser(userId: string): Promise<void> { await this.client.request(`/users/${userId}`, { method: 'DELETE' }); }

  async listGroups(options?: { $top?: number; $filter?: string }): Promise<MEGroupList> {
    return this.client.request<MEGroupList>('/groups', { params: { $top: options?.$top, $filter: options?.$filter } });
  }
  async getGroup(groupId: string): Promise<MEGroup> { return this.client.request<MEGroup>(`/groups/${groupId}`); }
  async getGroupMembers(groupId: string): Promise<MEUserList> { return this.client.request<MEUserList>(`/groups/${groupId}/members`); }
  async addGroupMember(groupId: string, userId: string): Promise<void> {
    await this.client.request(`/groups/${groupId}/members/$ref`, { method: 'POST', body: { '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${userId}` } });
  }

  async listApplications(): Promise<{ value: MEApp[] }> { return this.client.request('/applications'); }

  getClient(): MSEntraIDClient { return this.client; }
}
