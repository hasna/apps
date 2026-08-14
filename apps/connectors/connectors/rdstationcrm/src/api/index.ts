// RD Station CRM Connector — Brazilian CRM for leads and sales pipelines
import { RDStationCRMClient } from './client';
import type { RDStationCRMConfig, RDDeal, RDDealList, RDContact, RDOrganization, RDDealStage, RDUser } from '../types';
export { RDStationCRMClient } from './client';

export class RDStationCRM {
  private readonly client: RDStationCRMClient;
  constructor(config: RDStationCRMConfig) { this.client = new RDStationCRMClient(config); }
  static fromEnv(): RDStationCRM {
    const token = process.env.RDSTATIONCRM_TOKEN;
    if (!token) throw new Error('RDSTATIONCRM_TOKEN is required');
    return new RDStationCRM({ token });
  }

  async listDeals(options?: { page?: number; limit?: number; win?: boolean; deal_stage_id?: string }): Promise<RDDealList> {
    return this.client.request<RDDealList>('/deals', { params: { page: options?.page, limit: options?.limit, win: options?.win === true ? 'true' : options?.win === false ? 'false' : undefined, deal_stage_id: options?.deal_stage_id } });
  }
  async getDeal(dealId: string): Promise<RDDeal> { return this.client.request<RDDeal>(`/deals/${dealId}`); }
  async createDeal(data: { name: string; amount?: number; deal_stage_id: string; user_id?: string; organization_id?: string }): Promise<RDDeal> {
    return this.client.request<RDDeal>('/deals', { method: 'POST', body: { deal: data } as Record<string, unknown> });
  }
  async updateDeal(dealId: string, data: { name?: string; amount?: number; deal_stage_id?: string; win?: boolean }): Promise<RDDeal> {
    return this.client.request<RDDeal>(`/deals/${dealId}`, { method: 'PUT', body: { deal: data } as Record<string, unknown> });
  }

  async listContacts(options?: { page?: number; limit?: number }): Promise<{ contacts: RDContact[] }> {
    return this.client.request('/contacts', { params: { page: options?.page, limit: options?.limit } });
  }
  async getContact(contactId: string): Promise<RDContact> { return this.client.request<RDContact>(`/contacts/${contactId}`); }
  async createContact(data: { name: string; title?: string; emails?: { email: string }[]; phones?: { phone: string }[] }): Promise<RDContact> {
    return this.client.request<RDContact>('/contacts', { method: 'POST', body: { contact: data } as Record<string, unknown> });
  }

  async listOrganizations(options?: { page?: number }): Promise<{ organizations: RDOrganization[] }> {
    return this.client.request('/organizations', { params: { page: options?.page } });
  }

  async listDealStages(): Promise<{ deal_stages: RDDealStage[] }> { return this.client.request('/deal_stages'); }
  async listUsers(): Promise<{ users: RDUser[] }> { return this.client.request('/users'); }

  getClient(): RDStationCRMClient { return this.client; }
}
