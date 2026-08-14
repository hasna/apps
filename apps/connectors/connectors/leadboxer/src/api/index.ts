// LeadBoxer Connector — Lead identification and website visitor tracking
import { LeadBoxerClient } from './client';
import type { LeadBoxerConfig, LBLead, LBLeadList, LBEvent, LBSegment } from '../types';
export { LeadBoxerClient } from './client';

export class LeadBoxer {
  private readonly client: LeadBoxerClient;
  constructor(config: LeadBoxerConfig) { this.client = new LeadBoxerClient(config); }
  static fromEnv(): LeadBoxer {
    const apiKey = process.env.LEADBOXER_API_KEY;
    if (!apiKey) throw new Error('LEADBOXER_API_KEY is required');
    return new LeadBoxer({ apiKey });
  }

  async listLeads(options?: { page?: number; per_page?: number; score_min?: number; segment_id?: string }): Promise<LBLeadList> {
    return this.client.request<LBLeadList>('/leads', { params: { page: options?.page, per_page: options?.per_page, score_min: options?.score_min, segment_id: options?.segment_id } });
  }
  async getLead(leadId: string): Promise<LBLead> { return this.client.request<LBLead>(`/leads/${leadId}`); }

  async listEvents(leadId: string, options?: { page?: number }): Promise<{ events: LBEvent[] }> {
    return this.client.request(`/leads/${leadId}/events`, { params: { page: options?.page } });
  }

  async listSegments(): Promise<LBSegment[]> { return this.client.request<LBSegment[]>('/segments'); }

  getClient(): LeadBoxerClient { return this.client; }
}
