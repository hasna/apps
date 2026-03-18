// Microsoft Entra ID (Azure AD) Connector — Identity and directory services
import { EntraIDClient } from './client';
import type { EntraIDConfig, ADUser, ADUserList, ADGroup, ADGroupList, ADApplication, ADServicePrincipal, ADDomain } from '../types';
export { EntraIDClient } from './client';

export class EntraID {
  private readonly client: EntraIDClient;
  constructor(config: EntraIDConfig) { this.client = new EntraIDClient(config); }
  static fromEnv(): EntraID {
    const token = process.env.ENTRAID_TOKEN;
    if (!token) throw new Error('ENTRAID_TOKEN is required');
    return new EntraID({ token });
  }

  async listUsers(options?: { $top?: number; $filter?: string; $select?: string; $orderby?: string }): Promise<ADUserList> {
    return this.client.request<ADUserList>('/users', { params: { $top: options?.$top, $filter: options?.$filter, $select: options?.$select, $orderby: options?.$orderby } });
  }
  async getUser(userId: string): Promise<ADUser> { return this.client.request<ADUser>(`/users/${userId}`); }
  async createUser(data: { displayName: string; mailNickname: string; userPrincipalName: string; passwordProfile: { password: string; forceChangePasswordNextSignIn?: boolean }; accountEnabled: boolean }): Promise<ADUser> {
    return this.client.request<ADUser>('/users', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateUser(userId: string, data: { displayName?: string; jobTitle?: string; department?: string; accountEnabled?: boolean }): Promise<void> {
    await this.client.request(`/users/${userId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteUser(userId: string): Promise<void> { await this.client.request(`/users/${userId}`, { method: 'DELETE' }); }

  async listGroups(options?: { $top?: number; $filter?: string }): Promise<ADGroupList> {
    return this.client.request<ADGroupList>('/groups', { params: { $top: options?.$top, $filter: options?.$filter } });
  }
  async getGroup(groupId: string): Promise<ADGroup> { return this.client.request<ADGroup>(`/groups/${groupId}`); }
  async getGroupMembers(groupId: string): Promise<ADUserList> { return this.client.request<ADUserList>(`/groups/${groupId}/members`); }
  async addGroupMember(groupId: string, userId: string): Promise<void> {
    await this.client.request(`/groups/${groupId}/members/$ref`, { method: 'POST', body: { '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${userId}` } });
  }
  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    await this.client.request(`/groups/${groupId}/members/${userId}/$ref`, { method: 'DELETE' });
  }

  async listApplications(): Promise<{ value: ADApplication[] }> { return this.client.request('/applications'); }
  async listServicePrincipals(): Promise<{ value: ADServicePrincipal[] }> { return this.client.request('/servicePrincipals'); }
  async listDomains(): Promise<{ value: ADDomain[] }> { return this.client.request('/domains'); }

  getClient(): EntraIDClient { return this.client; }
}
