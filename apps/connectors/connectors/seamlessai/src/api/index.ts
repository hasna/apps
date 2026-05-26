// Seamless.AI Connector — AI-powered B2B sales prospecting and contact data
import { SeamlessAIClient } from './client';
import type { SeamlessAIConfig, SAContact, SAContactList, SACompany, SACompanyList, SASearchParams } from '../types';
export { SeamlessAIClient } from './client';

export class SeamlessAI {
  private readonly client: SeamlessAIClient;
  constructor(config: SeamlessAIConfig) { this.client = new SeamlessAIClient(config); }
  static fromEnv(): SeamlessAI {
    const apiKey = process.env.SEAMLESSAI_API_KEY;
    if (!apiKey) throw new Error('SEAMLESSAI_API_KEY is required');
    return new SeamlessAI({ apiKey });
  }

  async searchContacts(params: SASearchParams): Promise<SAContactList> {
    return this.client.request<SAContactList>('/contacts/search', { method: 'POST', body: params as Record<string, unknown> });
  }
  async getContact(contactId: string): Promise<SAContact> { return this.client.request<SAContact>(`/contacts/${contactId}`); }
  async listContacts(options?: { page?: number; per_page?: number }): Promise<SAContactList> {
    return this.client.request<SAContactList>('/contacts', { params: { page: options?.page, per_page: options?.per_page } });
  }

  async searchCompanies(params: SASearchParams): Promise<SACompanyList> {
    return this.client.request<SACompanyList>('/companies/search', { method: 'POST', body: params as Record<string, unknown> });
  }
  async getCompany(companyId: string): Promise<SACompany> { return this.client.request<SACompany>(`/companies/${companyId}`); }
  async listCompanies(options?: { page?: number; per_page?: number }): Promise<SACompanyList> {
    return this.client.request<SACompanyList>('/companies', { params: { page: options?.page, per_page: options?.per_page } });
  }

  async getCredits(): Promise<{ credits_remaining: number; credits_used: number }> {
    return this.client.request('/credits');
  }

  getClient(): SeamlessAIClient { return this.client; }
}
