// Auth0 Connector — Authentication and authorization platform
import { Auth0Client } from './client';
import type { Auth0Config, Auth0User, Auth0Role, Auth0Connection, Auth0Log, Auth0Organization } from '../types';
export { Auth0Client } from './client';

export class Auth0 {
  private readonly client: Auth0Client;
  constructor(config: Auth0Config) { this.client = new Auth0Client(config); }

  static fromEnv(): Auth0 {
    const domain = process.env.AUTH0_DOMAIN;
    const managementToken = process.env.AUTH0_MANAGEMENT_TOKEN;
    if (!domain || !managementToken) throw new Error('AUTH0_DOMAIN and AUTH0_MANAGEMENT_TOKEN are required');
    return new Auth0({ domain, managementToken });
  }

  // Users
  async listUsers(options?: { page?: number; perPage?: number; q?: string; fields?: string; sort?: string }): Promise<Auth0User[]> {
    return this.client.request<Auth0User[]>('/users', { params: { page: options?.page, per_page: options?.perPage, q: options?.q, fields: options?.fields, sort: options?.sort } });
  }
  async getUser(userId: string): Promise<Auth0User> { return this.client.request<Auth0User>(`/users/${encodeURIComponent(userId)}`); }
  async createUser(data: { email: string; password?: string; connection: string; name?: string; given_name?: string; family_name?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }): Promise<Auth0User> {
    return this.client.request<Auth0User>('/users', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateUser(userId: string, data: Partial<{ email: string; name: string; blocked: boolean; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> }>): Promise<Auth0User> {
    return this.client.request<Auth0User>(`/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteUser(userId: string): Promise<void> { await this.client.request(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }); }
  async blockUser(userId: string): Promise<Auth0User> { return this.updateUser(userId, { blocked: true }); }
  async unblockUser(userId: string): Promise<Auth0User> { return this.updateUser(userId, { blocked: false }); }
  async getUserRoles(userId: string): Promise<Auth0Role[]> { return this.client.request<Auth0Role[]>(`/users/${encodeURIComponent(userId)}/roles`); }
  async assignRolesToUser(userId: string, roleIds: string[]): Promise<void> { await this.client.request(`/users/${encodeURIComponent(userId)}/roles`, { method: 'POST', body: { roles: roleIds } }); }

  // Roles
  async listRoles(): Promise<Auth0Role[]> { return this.client.request<Auth0Role[]>('/roles'); }
  async getRole(roleId: string): Promise<Auth0Role> { return this.client.request<Auth0Role>(`/roles/${roleId}`); }
  async createRole(data: { name: string; description?: string }): Promise<Auth0Role> { return this.client.request<Auth0Role>('/roles', { method: 'POST', body: data as Record<string, unknown> }); }
  async deleteRole(roleId: string): Promise<void> { await this.client.request(`/roles/${roleId}`, { method: 'DELETE' }); }

  // Connections
  async listConnections(options?: { strategy?: string }): Promise<Auth0Connection[]> { return this.client.request<Auth0Connection[]>('/connections', { params: options as Record<string, string | undefined> }); }

  // Logs
  async getLogs(options?: { page?: number; perPage?: number; q?: string; sort?: string }): Promise<Auth0Log[]> {
    return this.client.request<Auth0Log[]>('/logs', { params: { page: options?.page, per_page: options?.perPage, q: options?.q, sort: options?.sort } });
  }

  // Organizations
  async listOrganizations(): Promise<Auth0Organization[]> { return this.client.request<Auth0Organization[]>('/organizations'); }
  async getOrganization(id: string): Promise<Auth0Organization> { return this.client.request<Auth0Organization>(`/organizations/${id}`); }

  getClient(): Auth0Client { return this.client; }
}
