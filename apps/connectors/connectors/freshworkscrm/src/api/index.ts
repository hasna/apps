// Freshworks CRM Connector — Sales CRM with AI-powered lead scoring
import { FreshworksCRMClient } from './client';
import type { FreshworksCRMConfig, FWContact, FWDeal, FWAccount, FWTask, FWNote } from '../types';
export { FreshworksCRMClient } from './client';

export class FreshworksCRM {
  private readonly client: FreshworksCRMClient;
  constructor(config: FreshworksCRMConfig) { this.client = new FreshworksCRMClient(config); }
  static fromEnv(): FreshworksCRM {
    const domain = process.env.FRESHWORKSCRM_DOMAIN;
    const apiKey = process.env.FRESHWORKSCRM_API_KEY;
    if (!domain || !apiKey) throw new Error('FRESHWORKSCRM_DOMAIN and FRESHWORKSCRM_API_KEY are required');
    return new FreshworksCRM({ domain, apiKey });
  }

  async listContacts(options?: { page?: number; sort?: string }): Promise<{ contacts: FWContact[] }> {
    return this.client.request('/contacts/view/1', { params: { page: options?.page, sort: options?.sort } });
  }
  async getContact(contactId: number): Promise<{ contact: FWContact }> { return this.client.request(`/contacts/${contactId}`); }
  async createContact(data: { first_name: string; last_name?: string; email?: string; mobile_number?: string; company_id?: number }): Promise<{ contact: FWContact }> {
    return this.client.request('/contacts', { method: 'POST', body: { contact: data } });
  }
  async updateContact(contactId: number, data: Record<string, unknown>): Promise<{ contact: FWContact }> {
    return this.client.request(`/contacts/${contactId}`, { method: 'PUT', body: { contact: data } });
  }

  async listDeals(options?: { page?: number }): Promise<{ deals: FWDeal[] }> {
    return this.client.request('/deals/view/1', { params: { page: options?.page } });
  }
  async getDeal(dealId: number): Promise<{ deal: FWDeal }> { return this.client.request(`/deals/${dealId}`); }
  async createDeal(data: { name: string; amount: number; deal_stage_id: number; deal_pipeline_id: number }): Promise<{ deal: FWDeal }> {
    return this.client.request('/deals', { method: 'POST', body: { deal: data } as Record<string, unknown> });
  }

  async listAccounts(options?: { page?: number }): Promise<{ sales_accounts: FWAccount[] }> {
    return this.client.request('/sales_accounts/view/1', { params: { page: options?.page } });
  }

  async listTasks(options?: { page?: number }): Promise<{ tasks: FWTask[] }> {
    return this.client.request('/tasks', { params: { page: options?.page } });
  }
  async createTask(data: { title: string; due_date: string; owner_id: number; targetable_type?: string; targetable_id?: number }): Promise<{ task: FWTask }> {
    return this.client.request('/tasks', { method: 'POST', body: { task: data } as Record<string, unknown> });
  }

  async searchContacts(query: string): Promise<{ contacts: FWContact[] }> {
    return this.client.request('/search', { params: { q: query, include: 'contact' } });
  }

  getClient(): FreshworksCRMClient { return this.client; }
}
