// Eartho Connector — Universal login and authentication platform
import { EarthoClient } from './client';
import type { EarthoConfig, EOUser, EOAccess, EOConnection } from '../types';
export { EarthoClient } from './client';

export class Eartho {
  private readonly client: EarthoClient;
  constructor(config: EarthoConfig) { this.client = new EarthoClient(config); }
  static fromEnv(): Eartho {
    const clientId = process.env.EARTHO_CLIENT_ID;
    const clientSecret = process.env.EARTHO_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('EARTHO_CLIENT_ID and EARTHO_CLIENT_SECRET are required');
    return new Eartho({ clientId, clientSecret });
  }

  async listUsers(options?: { page?: number; limit?: number }): Promise<{ users: EOUser[] }> {
    return this.client.request('/users', { params: { page: options?.page, limit: options?.limit } });
  }
  async getUser(uid: string): Promise<EOUser> { return this.client.request<EOUser>(`/users/${uid}`); }
  async deleteUser(uid: string): Promise<void> { await this.client.request(`/users/${uid}`, { method: 'DELETE' }); }

  async listAccesses(): Promise<{ accesses: EOAccess[] }> { return this.client.request('/accesses'); }
  async getAccess(accessId: string): Promise<EOAccess> { return this.client.request<EOAccess>(`/accesses/${accessId}`); }
  async createAccess(data: { name: string; description?: string; type?: string; price?: number; currency?: string }): Promise<EOAccess> {
    return this.client.request<EOAccess>('/accesses', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listConnections(): Promise<{ connections: EOConnection[] }> { return this.client.request('/connections'); }

  getClient(): EarthoClient { return this.client; }
}
