// Lighthouse Connector — Property management software for landlords
import { LighthouseClient } from './client';
import type { LighthouseConfig, LHProperty, LHTenant, LHTransaction, LHTransactionList, LHUnit, LHMaintenanceRequest } from '../types';
export { LighthouseClient } from './client';

export class Lighthouse {
  private readonly client: LighthouseClient;
  constructor(config: LighthouseConfig) { this.client = new LighthouseClient(config); }
  static fromEnv(): Lighthouse {
    const apiKey = process.env.LIGHTHOUSE_API_KEY;
    if (!apiKey) throw new Error('LIGHTHOUSE_API_KEY is required');
    return new Lighthouse({ apiKey });
  }

  async listProperties(): Promise<LHProperty[]> { return this.client.request<LHProperty[]>('/properties'); }
  async getProperty(propertyId: string): Promise<LHProperty> { return this.client.request<LHProperty>(`/properties/${propertyId}`); }
  async createProperty(data: { name: string; address: string; city: string; state?: string; zip?: string; type?: string }): Promise<LHProperty> {
    return this.client.request<LHProperty>('/properties', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listUnits(propertyId: string): Promise<LHUnit[]> { return this.client.request<LHUnit[]>(`/properties/${propertyId}/units`); }

  async listTenants(options?: { property_id?: string; status?: string }): Promise<LHTenant[]> {
    return this.client.request<LHTenant[]>('/tenants', { params: { property_id: options?.property_id, status: options?.status } });
  }
  async getTenant(tenantId: string): Promise<LHTenant> { return this.client.request<LHTenant>(`/tenants/${tenantId}`); }
  async createTenant(data: { property_id: string; unit_id: string; first_name: string; last_name: string; email?: string; rent_amount: number; lease_start: string; lease_end: string }): Promise<LHTenant> {
    return this.client.request<LHTenant>('/tenants', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTransactions(options?: { property_id?: string; type?: string; page?: number; per_page?: number }): Promise<LHTransactionList> {
    return this.client.request<LHTransactionList>('/transactions', { params: { property_id: options?.property_id, type: options?.type, page: options?.page, per_page: options?.per_page } });
  }
  async createTransaction(data: { property_id: string; type: 'income' | 'expense'; category: string; amount: number; date: string; description?: string; tenant_id?: string }): Promise<LHTransaction> {
    return this.client.request<LHTransaction>('/transactions', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listMaintenanceRequests(propertyId: string): Promise<LHMaintenanceRequest[]> {
    return this.client.request<LHMaintenanceRequest[]>(`/properties/${propertyId}/maintenance`);
  }

  getClient(): LighthouseClient { return this.client; }
}
