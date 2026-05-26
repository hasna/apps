// Teamgate Connector — Sales CRM with pipeline management and analytics
import { TeamgateClient } from './client';
import type { TeamgateConfig, TGLead, TGDeal, TGCompany, TGPerson, TGPipeline, TGListResult } from '../types';
export { TeamgateClient } from './client';

export class Teamgate {
  private readonly client: TeamgateClient;
  constructor(config: TeamgateConfig) { this.client = new TeamgateClient(config); }
  static fromEnv(): Teamgate {
    const authToken = process.env.TEAMGATE_AUTH_TOKEN;
    const appKey = process.env.TEAMGATE_APP_KEY;
    if (!authToken || !appKey) throw new Error('TEAMGATE_AUTH_TOKEN and TEAMGATE_APP_KEY are required');
    return new Teamgate({ authToken, appKey });
  }

  async listLeads(options?: { offset?: number; limit?: number; status?: string }): Promise<TGListResult<TGLead>> {
    return this.client.request<TGListResult<TGLead>>('/leads', { params: { offset: options?.offset, limit: options?.limit, status: options?.status } });
  }
  async getLead(leadId: number): Promise<TGLead> { return this.client.request<TGLead>(`/leads/${leadId}`); }
  async createLead(data: { name: string; email?: string; phone?: string; company?: string; source?: string }): Promise<TGLead> {
    return this.client.request<TGLead>('/leads', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listDeals(options?: { offset?: number; limit?: number; pipeline_id?: number }): Promise<TGListResult<TGDeal>> {
    return this.client.request<TGListResult<TGDeal>>('/deals', { params: { offset: options?.offset, limit: options?.limit, pipeline_id: options?.pipeline_id } });
  }
  async getDeal(dealId: number): Promise<TGDeal> { return this.client.request<TGDeal>(`/deals/${dealId}`); }
  async createDeal(data: { name: string; value?: number; pipeline_id: number; stage_id: number; company_id?: number }): Promise<TGDeal> {
    return this.client.request<TGDeal>('/deals', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateDeal(dealId: number, data: { stage_id?: number; value?: number; status?: string }): Promise<TGDeal> {
    return this.client.request<TGDeal>(`/deals/${dealId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }

  async listCompanies(options?: { offset?: number; limit?: number }): Promise<TGListResult<TGCompany>> {
    return this.client.request<TGListResult<TGCompany>>('/companies', { params: { offset: options?.offset, limit: options?.limit } });
  }
  async listPeople(options?: { offset?: number; limit?: number }): Promise<TGListResult<TGPerson>> {
    return this.client.request<TGListResult<TGPerson>>('/people', { params: { offset: options?.offset, limit: options?.limit } });
  }

  async listPipelines(): Promise<TGPipeline[]> { return this.client.request<TGPipeline[]>('/pipelines'); }

  getClient(): TeamgateClient { return this.client; }
}
