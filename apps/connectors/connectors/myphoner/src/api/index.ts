// Myphoner Connector — Lead tracking and cold calling CRM
import { MyphonerClient } from './client';
import type { MyphonerConfig, MPLead, MPLeadList, MPList, MPAgent, MPCall } from '../types';
export { MyphonerClient } from './client';

export class Myphoner {
  private readonly client: MyphonerClient;
  constructor(config: MyphonerConfig) { this.client = new MyphonerClient(config); }
  static fromEnv(): Myphoner {
    const apiKey = process.env.MYPHONER_API_KEY;
    if (!apiKey) throw new Error('MYPHONER_API_KEY is required');
    return new Myphoner({ apiKey });
  }

  async listLeads(options?: { page?: number; per_page?: number; list_id?: number; status?: string }): Promise<MPLeadList> {
    return this.client.request<MPLeadList>('/leads', { params: { page: options?.page, per_page: options?.per_page, list_id: options?.list_id, status: options?.status } });
  }
  async getLead(leadId: number): Promise<MPLead> { return this.client.request<MPLead>(`/leads/${leadId}`); }
  async createLead(data: { first_name: string; last_name?: string; email?: string; phone?: string; company?: string; list_id: number; custom_fields?: Record<string, string> }): Promise<MPLead> {
    return this.client.request<MPLead>('/leads', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateLead(leadId: number, data: { status?: string; agent_id?: number; custom_fields?: Record<string, string> }): Promise<MPLead> {
    return this.client.request<MPLead>(`/leads/${leadId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteLead(leadId: number): Promise<void> { await this.client.request(`/leads/${leadId}`, { method: 'DELETE' }); }

  async listLists(): Promise<MPList[]> { return this.client.request<MPList[]>('/lists'); }
  async listAgents(): Promise<MPAgent[]> { return this.client.request<MPAgent[]>('/agents'); }

  async listCalls(options?: { lead_id?: number; agent_id?: number }): Promise<MPCall[]> {
    return this.client.request<MPCall[]>('/calls', { params: { lead_id: options?.lead_id, agent_id: options?.agent_id } });
  }
  async logCall(data: { lead_id: number; outcome: string; duration?: number; notes?: string }): Promise<MPCall> {
    return this.client.request<MPCall>('/calls', { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): MyphonerClient { return this.client; }
}
