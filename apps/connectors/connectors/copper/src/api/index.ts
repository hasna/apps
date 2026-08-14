// Copper Connector — CRM built for Google Workspace
import { CopperClient } from './client';
import type { CopperConfig, CUPerson, CUCompany, CUOpportunity, CUTask, CUPipeline } from '../types';
export { CopperClient } from './client';

export class Copper {
  private readonly client: CopperClient;
  constructor(config: CopperConfig) { this.client = new CopperClient(config); }
  static fromEnv(): Copper {
    const apiKey = process.env.COPPER_API_KEY;
    const email = process.env.COPPER_EMAIL;
    if (!apiKey || !email) throw new Error('COPPER_API_KEY and COPPER_EMAIL are required');
    return new Copper({ apiKey, email });
  }

  async listPeople(options?: { page_size?: number; page_number?: number }): Promise<CUPerson[]> {
    return this.client.request<CUPerson[]>('/people/search', { method: 'POST', body: { page_size: options?.page_size, page_number: options?.page_number } as Record<string, unknown> });
  }
  async getPerson(personId: number): Promise<CUPerson> { return this.client.request<CUPerson>(`/people/${personId}`); }
  async createPerson(data: { name?: string; first_name?: string; last_name?: string; emails?: { email: string; category: string }[]; company_id?: number }): Promise<CUPerson> {
    return this.client.request<CUPerson>('/people', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updatePerson(personId: number, data: Record<string, unknown>): Promise<CUPerson> {
    return this.client.request<CUPerson>(`/people/${personId}`, { method: 'PUT', body: data });
  }

  async listCompanies(options?: { page_size?: number; page_number?: number }): Promise<CUCompany[]> {
    return this.client.request<CUCompany[]>('/companies/search', { method: 'POST', body: { page_size: options?.page_size, page_number: options?.page_number } as Record<string, unknown> });
  }
  async getCompany(companyId: number): Promise<CUCompany> { return this.client.request<CUCompany>(`/companies/${companyId}`); }

  async listOpportunities(options?: { page_size?: number; pipeline_ids?: number[] }): Promise<CUOpportunity[]> {
    return this.client.request<CUOpportunity[]>('/opportunities/search', { method: 'POST', body: { page_size: options?.page_size, pipeline_ids: options?.pipeline_ids } as Record<string, unknown> });
  }
  async getOpportunity(opportunityId: number): Promise<CUOpportunity> { return this.client.request<CUOpportunity>(`/opportunities/${opportunityId}`); }
  async createOpportunity(data: { name: string; pipeline_id: number; pipeline_stage_id: number; monetary_value?: number; company_id?: number }): Promise<CUOpportunity> {
    return this.client.request<CUOpportunity>('/opportunities', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTasks(options?: { page_size?: number; status?: string }): Promise<CUTask[]> {
    return this.client.request<CUTask[]>('/tasks/search', { method: 'POST', body: { page_size: options?.page_size, status: options?.status } as Record<string, unknown> });
  }

  async listPipelines(): Promise<CUPipeline[]> { return this.client.request<CUPipeline[]>('/pipelines'); }

  getClient(): CopperClient { return this.client; }
}
