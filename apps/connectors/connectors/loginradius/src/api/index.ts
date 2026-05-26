// LoginRadius Connector — Customer identity and access management (CIAM)
import { LoginRadiusClient } from './client';
import type { LoginRadiusConfig, LRProfile, LRRole, LRCustomObject } from '../types';
export { LoginRadiusClient } from './client';

export class LoginRadius {
  private readonly client: LoginRadiusClient;
  constructor(config: LoginRadiusConfig) { this.client = new LoginRadiusClient(config); }
  static fromEnv(): LoginRadius {
    const apiKey = process.env.LOGINRADIUS_API_KEY;
    const apiSecret = process.env.LOGINRADIUS_API_SECRET;
    const appName = process.env.LOGINRADIUS_APP_NAME;
    if (!apiKey || !apiSecret || !appName) throw new Error('LOGINRADIUS_API_KEY, LOGINRADIUS_API_SECRET, and LOGINRADIUS_APP_NAME are required');
    return new LoginRadius({ apiKey, apiSecret, appName });
  }

  async getProfileByUid(uid: string): Promise<LRProfile> { return this.client.request<LRProfile>(`/identity/v2/manage/account/${uid}`); }
  async getProfileByEmail(email: string): Promise<LRProfile> { return this.client.request<LRProfile>('/identity/v2/manage/account', { params: { email } }); }
  async createAccount(data: { Email: { Type: string; Value: string }[]; Password: string; FirstName?: string; LastName?: string }): Promise<LRProfile> {
    return this.client.request<LRProfile>('/identity/v2/manage/account', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateAccount(uid: string, data: { FirstName?: string; LastName?: string; [key: string]: unknown }): Promise<LRProfile> {
    return this.client.request<LRProfile>(`/identity/v2/manage/account/${uid}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteAccount(uid: string): Promise<void> { await this.client.request(`/identity/v2/manage/account/${uid}`, { method: 'DELETE' }); }
  async blockAccount(uid: string): Promise<LRProfile> {
    return this.client.request<LRProfile>(`/identity/v2/manage/account/${uid}/status`, { method: 'PUT', body: { isActive: false } });
  }

  async getRoles(): Promise<{ data: LRRole[] }> { return this.client.request('/identity/v2/manage/role'); }
  async assignRoles(uid: string, roles: string[]): Promise<void> {
    await this.client.request(`/identity/v2/manage/account/${uid}/role`, { method: 'PUT', body: { Roles: roles } });
  }

  async getCustomObject(uid: string, objectName: string): Promise<LRCustomObject[]> {
    return this.client.request<LRCustomObject[]>(`/identity/v2/manage/account/${uid}/customobject`, { params: { objectname: objectName } });
  }
  async createCustomObject(uid: string, objectName: string, data: Record<string, unknown>): Promise<LRCustomObject> {
    return this.client.request<LRCustomObject>(`/identity/v2/manage/account/${uid}/customobject`, { method: 'POST', params: { objectname: objectName }, body: data });
  }

  getClient(): LoginRadiusClient { return this.client; }
}
