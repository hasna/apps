// Customer.io Connector — Messaging automation platform
import { CustomerIOClient } from './client';
import type { CustomerIOConfig, CIOCustomer, CIOSegment, CIOCampaign, CIOMessageList } from '../types';
export { CustomerIOClient } from './client';

export class CustomerIO {
  private readonly client: CustomerIOClient;
  constructor(config: CustomerIOConfig) { this.client = new CustomerIOClient(config); }
  static fromEnv(): CustomerIO {
    const siteId = process.env.CUSTOMERIO_SITE_ID;
    const apiKey = process.env.CUSTOMERIO_API_KEY;
    if (!siteId || !apiKey) throw new Error('CUSTOMERIO_SITE_ID and CUSTOMERIO_API_KEY are required');
    return new CustomerIO({ siteId, apiKey, appApiKey: process.env.CUSTOMERIO_APP_API_KEY });
  }

  // Track API (Basic auth)
  async identify(customerId: string, attributes: Record<string, unknown>): Promise<void> {
    await this.client.trackRequest(`/customers/${customerId}`, { method: 'PUT', body: attributes });
  }
  async deleteCustomer(customerId: string): Promise<void> {
    await this.client.trackRequest(`/customers/${customerId}`, { method: 'DELETE' });
  }
  async track(customerId: string, eventName: string, data?: Record<string, unknown>): Promise<void> {
    await this.client.trackRequest(`/customers/${customerId}/events`, { method: 'POST', body: { name: eventName, data } });
  }
  async trackAnonymous(eventName: string, data?: Record<string, unknown>): Promise<void> {
    await this.client.trackRequest('/events', { method: 'POST', body: { name: eventName, data } });
  }

  // App API (Bearer auth)
  async listSegments(): Promise<{ segments: CIOSegment[] }> { return this.client.appRequest('/segments'); }
  async getSegmentMembers(segmentId: number): Promise<{ ids: string[] }> { return this.client.appRequest(`/segments/${segmentId}/membership`); }
  async listCampaigns(): Promise<{ campaigns: CIOCampaign[] }> { return this.client.appRequest('/campaigns'); }
  async getCampaign(campaignId: number): Promise<CIOCampaign> { return this.client.appRequest<CIOCampaign>(`/campaigns/${campaignId}`); }
  async listMessages(options?: { limit?: number; start?: string }): Promise<CIOMessageList> {
    return this.client.appRequest<CIOMessageList>('/messages', { params: { limit: options?.limit, start: options?.start } });
  }
  async getCustomer(customerId: string): Promise<{ customer: CIOCustomer }> { return this.client.appRequest(`/customers/${customerId}/attributes`); }

  getClient(): CustomerIOClient { return this.client; }
}
