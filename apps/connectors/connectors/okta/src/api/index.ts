// Okta Connector — Identity and access management
import { OktaClient } from './client';
import type { OktaConfig, OktaUser, OktaGroup, OktaApp, OktaAuthServer, OktaLog } from '../types';
export { OktaClient } from './client';

export class Okta {
  private readonly client: OktaClient;
  constructor(config: OktaConfig) { this.client = new OktaClient(config); }
  static fromEnv(): Okta {
    const domain = process.env.OKTA_DOMAIN;
    const token = process.env.OKTA_TOKEN;
    if (!domain || !token) throw new Error('OKTA_DOMAIN and OKTA_TOKEN are required');
    return new Okta({ domain, token });
  }

  async listUsers(options?: { limit?: number; after?: string; search?: string; filter?: string }): Promise<OktaUser[]> {
    return this.client.request<OktaUser[]>('/users', { params: { limit: options?.limit, after: options?.after, search: options?.search, filter: options?.filter } });
  }
  async getUser(userId: string): Promise<OktaUser> { return this.client.request<OktaUser>(`/users/${userId}`); }
  async createUser(data: { profile: { firstName: string; lastName: string; email: string; login: string }; credentials?: { password?: { value: string } } }): Promise<OktaUser> {
    return this.client.request<OktaUser>('/users', { method: 'POST', body: data as Record<string, unknown>, params: { activate: 'true' } });
  }
  async updateUser(userId: string, profile: Record<string, unknown>): Promise<OktaUser> {
    return this.client.request<OktaUser>(`/users/${userId}`, { method: 'POST', body: { profile } });
  }
  async deactivateUser(userId: string): Promise<void> { await this.client.request(`/users/${userId}/lifecycle/deactivate`, { method: 'POST' }); }
  async suspendUser(userId: string): Promise<void> { await this.client.request(`/users/${userId}/lifecycle/suspend`, { method: 'POST' }); }
  async unsuspendUser(userId: string): Promise<void> { await this.client.request(`/users/${userId}/lifecycle/unsuspend`, { method: 'POST' }); }

  async listGroups(options?: { limit?: number; after?: string; search?: string }): Promise<OktaGroup[]> {
    return this.client.request<OktaGroup[]>('/groups', { params: { limit: options?.limit, after: options?.after, q: options?.search } });
  }
  async getGroup(groupId: string): Promise<OktaGroup> { return this.client.request<OktaGroup>(`/groups/${groupId}`); }
  async getGroupMembers(groupId: string): Promise<OktaUser[]> { return this.client.request<OktaUser[]>(`/groups/${groupId}/users`); }
  async addUserToGroup(groupId: string, userId: string): Promise<void> { await this.client.request(`/groups/${groupId}/users/${userId}`, { method: 'PUT' }); }
  async removeUserFromGroup(groupId: string, userId: string): Promise<void> { await this.client.request(`/groups/${groupId}/users/${userId}`, { method: 'DELETE' }); }

  async listApps(options?: { limit?: number; after?: string }): Promise<OktaApp[]> {
    return this.client.request<OktaApp[]>('/apps', { params: { limit: options?.limit, after: options?.after } });
  }

  async listAuthServers(): Promise<OktaAuthServer[]> { return this.client.request<OktaAuthServer[]>('/authorizationServers'); }

  async getLogs(options?: { since?: string; until?: string; filter?: string; limit?: number }): Promise<OktaLog[]> {
    return this.client.request<OktaLog[]>('/logs', { params: { since: options?.since, until: options?.until, filter: options?.filter, limit: options?.limit } });
  }

  getClient(): OktaClient { return this.client; }
}
