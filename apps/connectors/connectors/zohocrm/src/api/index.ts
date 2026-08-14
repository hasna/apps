// Zoho CRM Connector — CRM for sales, marketing, and customer support
import { ZohoCRMClient } from './client';
import type { ZohoCRMConfig, ZohoRecord, ZohoRecordList, ZohoModule, ZohoField, ZohoUser, ZohoNote } from '../types';
export { ZohoCRMClient } from './client';

export class ZohoCRM {
  private readonly client: ZohoCRMClient;
  constructor(config: ZohoCRMConfig) { this.client = new ZohoCRMClient(config); }
  static fromEnv(): ZohoCRM {
    const token = process.env.ZOHOCRM_TOKEN;
    if (!token) throw new Error('ZOHOCRM_TOKEN is required');
    return new ZohoCRM({ token, baseUrl: process.env.ZOHOCRM_BASE_URL });
  }

  async listRecords(module: string, options?: { page?: number; per_page?: number; fields?: string; sort_by?: string; sort_order?: string }): Promise<ZohoRecordList> {
    return this.client.request<ZohoRecordList>(`/${module}`, { params: { page: options?.page, per_page: options?.per_page, fields: options?.fields, sort_by: options?.sort_by, sort_order: options?.sort_order } });
  }
  async getRecord(module: string, recordId: string): Promise<{ data: ZohoRecord[] }> { return this.client.request(`/${module}/${recordId}`); }
  async createRecord(module: string, data: Record<string, unknown>): Promise<{ data: { details: { id: string } }[] }> {
    return this.client.request(`/${module}`, { method: 'POST', body: { data: [data] } });
  }
  async updateRecord(module: string, recordId: string, data: Record<string, unknown>): Promise<{ data: { details: { id: string } }[] }> {
    return this.client.request(`/${module}/${recordId}`, { method: 'PUT', body: { data: [data] } });
  }
  async deleteRecord(module: string, recordId: string): Promise<void> { await this.client.request(`/${module}/${recordId}`, { method: 'DELETE' }); }

  async searchRecords(module: string, criteria: string, options?: { page?: number; per_page?: number }): Promise<ZohoRecordList> {
    return this.client.request<ZohoRecordList>(`/${module}/search`, { params: { criteria, page: options?.page, per_page: options?.per_page } });
  }

  async listModules(): Promise<{ modules: ZohoModule[] }> { return this.client.request('/settings/modules'); }
  async listFields(module: string): Promise<{ fields: ZohoField[] }> { return this.client.request(`/settings/fields`, { params: { module } }); }

  async listUsers(options?: { type?: string }): Promise<{ users: ZohoUser[] }> {
    return this.client.request('/users', { params: { type: options?.type || 'AllUsers' } });
  }

  async listNotes(options?: { page?: number; per_page?: number }): Promise<{ data: ZohoNote[] }> {
    return this.client.request('/Notes', { params: { page: options?.page, per_page: options?.per_page } });
  }
  async createNote(parentModule: string, parentId: string, title: string, content: string): Promise<{ data: { details: { id: string } }[] }> {
    return this.client.request('/Notes', { method: 'POST', body: { data: [{ Note_Title: title, Note_Content: content, Parent_Id: parentId, se_module: parentModule }] } });
  }

  getClient(): ZohoCRMClient { return this.client; }
}
