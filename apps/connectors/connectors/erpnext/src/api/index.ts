// ERPNext Connector — Open-source ERP for accounting, inventory, and business
import { ERPNextClient } from './client';
import type { ERPNextConfig, ENDocument, ENDocumentList } from '../types';
export { ERPNextClient } from './client';

export class ERPNext {
  private readonly client: ERPNextClient;
  constructor(config: ERPNextConfig) { this.client = new ERPNextClient(config); }
  static fromEnv(): ERPNext {
    const url = process.env.ERPNEXT_URL;
    const apiKey = process.env.ERPNEXT_API_KEY;
    const apiSecret = process.env.ERPNEXT_API_SECRET;
    if (!url || !apiKey || !apiSecret) throw new Error('ERPNEXT_URL, ERPNEXT_API_KEY, and ERPNEXT_API_SECRET are required');
    return new ERPNext({ url, apiKey, apiSecret });
  }

  async listDocuments(doctype: string, options?: { filters?: string; fields?: string; limit_page_length?: number; order_by?: string }): Promise<ENDocumentList> {
    return this.client.request<ENDocumentList>(`/resource/${doctype}`, { params: { filters: options?.filters, fields: options?.fields, limit_page_length: options?.limit_page_length, order_by: options?.order_by } });
  }
  async getDocument(doctype: string, name: string): Promise<{ data: ENDocument }> {
    return this.client.request(`/resource/${doctype}/${name}`);
  }
  async createDocument(doctype: string, data: Record<string, unknown>): Promise<{ data: ENDocument }> {
    return this.client.request(`/resource/${doctype}`, { method: 'POST', body: data });
  }
  async updateDocument(doctype: string, name: string, data: Record<string, unknown>): Promise<{ data: ENDocument }> {
    return this.client.request(`/resource/${doctype}/${name}`, { method: 'PUT', body: data });
  }
  async deleteDocument(doctype: string, name: string): Promise<void> {
    await this.client.request(`/resource/${doctype}/${name}`, { method: 'DELETE' });
  }

  async callMethod(method: string, args?: Record<string, unknown>): Promise<{ message: unknown }> {
    return this.client.request(`/method/${method}`, args ? { method: 'POST', body: args } : {});
  }

  async search(doctype: string, query: string, options?: { filters?: string; page_length?: number }): Promise<{ results: string[][] }> {
    return this.client.request('/method/frappe.client.get_list', { params: { doctype, txt: query, filters: options?.filters, page_length: options?.page_length } });
  }

  getClient(): ERPNextClient { return this.client; }
}
