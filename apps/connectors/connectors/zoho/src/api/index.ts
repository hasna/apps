// Zoho CRM v8 Connector — contacts, leads, accounts, and deals

import { ZohoClient } from './client';
import type {
  ZohoConfig,
  ZohoRecord,
  ZohoRecordList,
  ZohoCreateResponse,
  ZohoRawRequestOptions,
} from '../types';

export { ZohoClient, DEFAULT_BASE_URL } from './client';

export interface ListOptions {
  page?: number;
  per_page?: number;
  fields?: string;
  sort_by?: string;
  sort_order?: string;
}

export class Zoho {
  private readonly client: ZohoClient;

  constructor(config: ZohoConfig) {
    this.client = new ZohoClient(config);
  }

  static fromEnv(): Zoho {
    const accessToken = process.env.ZOHO_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('ZOHO_ACCESS_TOKEN is required');
    }
    return new Zoho({
      accessToken,
      baseUrl: process.env.ZOHO_BASE_URL,
    });
  }

  async listContacts(options?: ListOptions): Promise<ZohoRecordList> {
    return this.client.request<ZohoRecordList>('/Contacts', {
      params: options as Record<string, string | number | boolean | undefined>,
    });
  }

  async getContact(contactId: string, options?: Omit<ListOptions, 'page' | 'per_page'>): Promise<{ data: ZohoRecord[] }> {
    return this.client.request(`/Contacts/${encodeURIComponent(contactId)}`, {
      params: options as Record<string, string | number | boolean | undefined>,
    });
  }

  async addContacts(records: ZohoRecord[]): Promise<ZohoCreateResponse> {
    return this.client.request<ZohoCreateResponse>('/Contacts', {
      method: 'POST',
      body: { data: records },
    });
  }

  async listLeads(options?: ListOptions): Promise<ZohoRecordList> {
    return this.client.request<ZohoRecordList>('/Leads', { params: options as Record<string, string | number | boolean | undefined> });
  }

  async listAccounts(options?: ListOptions): Promise<ZohoRecordList> {
    return this.client.request<ZohoRecordList>('/Accounts', { params: options as Record<string, string | number | boolean | undefined> });
  }

  async listDeals(options?: ListOptions): Promise<ZohoRecordList> {
    return this.client.request<ZohoRecordList>('/Deals', { params: options as Record<string, string | number | boolean | undefined> });
  }

  async rawRequest(path: string, options?: ZohoRawRequestOptions): Promise<unknown> {
    return this.client.request(path, {
      method: options?.method,
      body: options?.body,
      params: options?.params,
    });
  }

  getClient(): ZohoClient {
    return this.client;
  }
}
