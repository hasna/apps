// LimeGo Connector — B2B sales intelligence and prospecting
import { LimeGoClient } from './client';
import type { LimeGoConfig, LGCompany, LGCompanyList, LGContact, LGContactList, LGSearchParams } from '../types';
export { LimeGoClient } from './client';

export class LimeGo {
  private readonly client: LimeGoClient;
  constructor(config: LimeGoConfig) { this.client = new LimeGoClient(config); }
  static fromEnv(): LimeGo {
    const apiKey = process.env.LIMEGO_API_KEY;
    if (!apiKey) throw new Error('LIMEGO_API_KEY is required');
    return new LimeGo({ apiKey });
  }

  async searchCompanies(params: LGSearchParams): Promise<LGCompanyList> {
    return this.client.request<LGCompanyList>('/companies/search', { method: 'POST', body: params as Record<string, unknown> });
  }
  async getCompany(companyId: string): Promise<LGCompany> { return this.client.request<LGCompany>(`/companies/${companyId}`); }
  async listCompanies(options?: { page?: number; per_page?: number }): Promise<LGCompanyList> {
    return this.client.request<LGCompanyList>('/companies', { params: { page: options?.page, per_page: options?.per_page } });
  }

  async searchContacts(params: LGSearchParams): Promise<LGContactList> {
    return this.client.request<LGContactList>('/contacts/search', { method: 'POST', body: params as Record<string, unknown> });
  }
  async getContact(contactId: string): Promise<LGContact> { return this.client.request<LGContact>(`/contacts/${contactId}`); }
  async listContacts(options?: { company_id?: string; page?: number; per_page?: number }): Promise<LGContactList> {
    return this.client.request<LGContactList>('/contacts', { params: { company_id: options?.company_id, page: options?.page, per_page: options?.per_page } });
  }

  getClient(): LimeGoClient { return this.client; }
}
