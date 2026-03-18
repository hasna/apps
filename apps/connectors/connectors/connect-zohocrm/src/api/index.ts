// Zoho CRM Connector — CRM for sales, marketing, and customer support
import { ZohoCRMClient } from './client';
import type { ZohoCRMConfig, ZohoLead, ZohoContact, ZohoDeal, ZohoAccount, ZohoListResponse, ZohoCreateResponse } from '../types';
export { ZohoCRMClient } from './client';

type Module = 'Leads' | 'Contacts' | 'Deals' | 'Accounts' | 'Activities' | 'Tasks' | 'Calls' | 'Events';

export class ZohoCRM {
  private readonly client: ZohoCRMClient;
  constructor(config: ZohoCRMConfig) { this.client = new ZohoCRMClient(config); }

  static fromEnv(): ZohoCRM {
    const accessToken = process.env.ZOHO_CRM_ACCESS_TOKEN || process.env.ZOHO_ACCESS_TOKEN;
    if (!accessToken) throw new Error('ZOHO_CRM_ACCESS_TOKEN environment variable is required');
    return new ZohoCRM({ accessToken, region: (process.env.ZOHO_REGION as ZohoCRMConfig['region']) || 'com' });
  }

  private async list<T>(module: Module, options?: { page?: number; perPage?: number; fields?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' }): Promise<ZohoListResponse<T>> {
    return this.client.request(`/${module}`, { params: { page: options?.page, per_page: options?.perPage, fields: options?.fields, sort_by: options?.sortBy, sort_order: options?.sortOrder } });
  }
  private async get<T>(module: Module, id: string): Promise<T> { const r = await this.client.request<ZohoListResponse<T>>(`/${module}/${id}`); return r.data[0]; }
  private async create<T>(module: Module, data: Partial<T>): Promise<string> { const r = await this.client.request<ZohoCreateResponse>(`/${module}`, { method: 'POST', body: { data: [data] } }); return r.data[0].details.id; }
  private async update<T>(module: Module, id: string, data: Partial<T>): Promise<void> { await this.client.request(`/${module}/${id}`, { method: 'PUT', body: { data: [data] } }); }
  private async del(module: Module, id: string): Promise<void> { await this.client.request(`/${module}/${id}`, { method: 'DELETE' }); }

  // Leads
  async listLeads(options?: Parameters<ZohoCRM['list']>[1]): Promise<ZohoListResponse<ZohoLead>> { return this.list<ZohoLead>('Leads', options); }
  async getLead(id: string): Promise<ZohoLead> { return this.get<ZohoLead>('Leads', id); }
  async createLead(data: Omit<ZohoLead, 'id'>): Promise<string> { return this.create('Leads', data); }
  async updateLead(id: string, data: Partial<ZohoLead>): Promise<void> { return this.update('Leads', id, data); }
  async deleteLead(id: string): Promise<void> { return this.del('Leads', id); }

  // Contacts
  async listContacts(options?: Parameters<ZohoCRM['list']>[1]): Promise<ZohoListResponse<ZohoContact>> { return this.list<ZohoContact>('Contacts', options); }
  async getContact(id: string): Promise<ZohoContact> { return this.get<ZohoContact>('Contacts', id); }
  async createContact(data: Omit<ZohoContact, 'id'>): Promise<string> { return this.create('Contacts', data); }
  async updateContact(id: string, data: Partial<ZohoContact>): Promise<void> { return this.update('Contacts', id, data); }

  // Deals
  async listDeals(options?: Parameters<ZohoCRM['list']>[1]): Promise<ZohoListResponse<ZohoDeal>> { return this.list<ZohoDeal>('Deals', options); }
  async getDeal(id: string): Promise<ZohoDeal> { return this.get<ZohoDeal>('Deals', id); }
  async createDeal(data: Omit<ZohoDeal, 'id'>): Promise<string> { return this.create('Deals', data); }
  async updateDeal(id: string, data: Partial<ZohoDeal>): Promise<void> { return this.update('Deals', id, data); }

  // Accounts
  async listAccounts(options?: Parameters<ZohoCRM['list']>[1]): Promise<ZohoListResponse<ZohoAccount>> { return this.list<ZohoAccount>('Accounts', options); }
  async getAccount(id: string): Promise<ZohoAccount> { return this.get<ZohoAccount>('Accounts', id); }
  async createAccount(data: Omit<ZohoAccount, 'id'>): Promise<string> { return this.create('Accounts', data); }

  // Search
  async search(module: Module, criteria: string, options?: { page?: number; perPage?: number }): Promise<ZohoListResponse<Record<string, unknown>>> {
    return this.client.request(`/${module}/search`, { params: { criteria, page: options?.page, per_page: options?.perPage } });
  }

  getClient(): ZohoCRMClient { return this.client; }
}
