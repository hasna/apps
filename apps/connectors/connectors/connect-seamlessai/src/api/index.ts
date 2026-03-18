// Seamless.AI Connector — B2B sales prospecting and contact data
import { SeamlessAIClient } from './client';
import type { SeamlessAIConfig, SAIContact, SAICompany, SearchContactsOptions, SearchCompaniesOptions } from '../types';
export { SeamlessAIClient } from './client';
export class SeamlessAI {
  private readonly client: SeamlessAIClient;
  constructor(config: SeamlessAIConfig) { this.client = new SeamlessAIClient(config); }
  static fromEnv(): SeamlessAI {
    const apiKey = process.env.SEAMLESSAI_API_KEY;
    if (!apiKey) throw new Error('SEAMLESSAI_API_KEY environment variable is required');
    return new SeamlessAI({ apiKey });
  }
  async searchContacts(options: SearchContactsOptions): Promise<{ contacts: SAIContact[]; total: number; page: number }> {
    return this.client.request('/contacts/search', options as Record<string, unknown>);
  }
  async getContact(contactId: string): Promise<SAIContact> { return this.client.request<SAIContact>(`/contacts/${contactId}`); }
  async searchCompanies(options: SearchCompaniesOptions): Promise<{ companies: SAICompany[]; total: number; page: number }> {
    return this.client.request('/companies/search', options as Record<string, unknown>);
  }
  async getCompany(companyId: string): Promise<SAICompany> { return this.client.request<SAICompany>(`/companies/${companyId}`); }
  async getCredits(): Promise<{ used: number; total: number; remaining: number }> {
    return this.client.request('/account/credits');
  }
  getClient(): SeamlessAIClient { return this.client; }
}
