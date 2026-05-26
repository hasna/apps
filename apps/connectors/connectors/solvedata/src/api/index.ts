// Solve.io Connector — Customer data platform for retail analytics
import { SolveDataClient } from './client';
import type { SolveDataConfig, SDCustomer, SDCustomerList, SDSegment, SDEvent } from '../types';
export { SolveDataClient } from './client';

export class SolveData {
  private readonly client: SolveDataClient;
  constructor(config: SolveDataConfig) { this.client = new SolveDataClient(config); }
  static fromEnv(): SolveData {
    const apiKey = process.env.SOLVEDATA_API_KEY;
    if (!apiKey) throw new Error('SOLVEDATA_API_KEY is required');
    return new SolveData({ apiKey });
  }

  async listCustomers(options?: { page?: number; per_page?: number; segment_id?: string }): Promise<SDCustomerList> {
    return this.client.request<SDCustomerList>('/customers', { params: { page: options?.page, per_page: options?.per_page, segment_id: options?.segment_id } });
  }
  async getCustomer(customerId: string): Promise<SDCustomer> { return this.client.request<SDCustomer>(`/customers/${customerId}`); }
  async searchCustomers(query: string): Promise<SDCustomerList> {
    return this.client.request<SDCustomerList>('/customers/search', { params: { q: query } });
  }

  async listSegments(): Promise<SDSegment[]> { return this.client.request<SDSegment[]>('/segments'); }
  async getSegment(segmentId: string): Promise<SDSegment> { return this.client.request<SDSegment>(`/segments/${segmentId}`); }

  async trackEvent(data: { customer_id: string; event_type: string; properties?: Record<string, unknown> }): Promise<SDEvent> {
    return this.client.request<SDEvent>('/events', { method: 'POST', body: data as Record<string, unknown> });
  }
  async listEvents(customerId: string, options?: { page?: number }): Promise<{ events: SDEvent[] }> {
    return this.client.request(`/customers/${customerId}/events`, { params: { page: options?.page } });
  }

  getClient(): SolveDataClient { return this.client; }
}
