// Keygen Connector — Software licensing and distribution API
import { KeygenClient } from './client';
import type { KeygenConfig, KGLicense, KGPolicy, KGMachine, KGUser, KGEntitlement } from '../types';
export { KeygenClient } from './client';

export class Keygen {
  private readonly client: KeygenClient;
  constructor(config: KeygenConfig) { this.client = new KeygenClient(config); }
  static fromEnv(): Keygen {
    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    const token = process.env.KEYGEN_TOKEN;
    if (!accountId || !token) throw new Error('KEYGEN_ACCOUNT_ID and KEYGEN_TOKEN are required');
    return new Keygen({ accountId, token });
  }

  async listLicenses(options?: { page?: number; limit?: number; status?: string }): Promise<{ data: KGLicense[] }> {
    return this.client.request('/licenses', { params: { 'page[number]': options?.page, 'page[size]': options?.limit, status: options?.status } });
  }
  async getLicense(licenseId: string): Promise<{ data: KGLicense }> { return this.client.request(`/licenses/${licenseId}`); }
  async createLicense(data: { policyId: string; userId?: string; name?: string; expiry?: string; maxMachines?: number }): Promise<{ data: KGLicense }> {
    return this.client.request('/licenses', { method: 'POST', body: { data: { type: 'licenses', attributes: { name: data.name, expiry: data.expiry, maxMachines: data.maxMachines }, relationships: { policy: { data: { type: 'policies', id: data.policyId } }, ...(data.userId ? { user: { data: { type: 'users', id: data.userId } } } : {}) } } } });
  }
  async validateLicense(licenseKey: string): Promise<{ data: KGLicense; meta: { valid: boolean; code: string } }> {
    return this.client.request('/licenses/actions/validate-key', { method: 'POST', body: { meta: { key: licenseKey } } });
  }
  async revokeLicense(licenseId: string): Promise<void> { await this.client.request(`/licenses/${licenseId}`, { method: 'DELETE' }); }

  async listPolicies(): Promise<{ data: KGPolicy[] }> { return this.client.request('/policies'); }
  async getPolicy(policyId: string): Promise<{ data: KGPolicy }> { return this.client.request(`/policies/${policyId}`); }

  async listMachines(licenseId: string): Promise<{ data: KGMachine[] }> { return this.client.request(`/licenses/${licenseId}/machines`); }
  async deactivateMachine(machineId: string): Promise<void> { await this.client.request(`/machines/${machineId}`, { method: 'DELETE' }); }

  async listUsers(options?: { page?: number; limit?: number }): Promise<{ data: KGUser[] }> {
    return this.client.request('/users', { params: { 'page[number]': options?.page, 'page[size]': options?.limit } });
  }

  async listEntitlements(): Promise<{ data: KGEntitlement[] }> { return this.client.request('/entitlements'); }

  getClient(): KeygenClient { return this.client; }
}
