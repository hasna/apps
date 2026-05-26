// CrowdPower Connector — Customer engagement and lifecycle automation
import { CrowdPowerClient } from './client';
import type { CrowdPowerConfig, CPUser, CPUserList, CPSegment, CPCampaign, CPEvent, CPTag } from '../types';
export { CrowdPowerClient } from './client';

export class CrowdPower {
  private readonly client: CrowdPowerClient;
  constructor(config: CrowdPowerConfig) { this.client = new CrowdPowerClient(config); }
  static fromEnv(): CrowdPower {
    const apiKey = process.env.CROWDPOWER_API_KEY;
    if (!apiKey) throw new Error('CROWDPOWER_API_KEY is required');
    return new CrowdPower({ apiKey });
  }

  async listUsers(options?: { page?: number; per_page?: number; segment_id?: string }): Promise<CPUserList> {
    return this.client.request<CPUserList>('/users', { params: { page: options?.page, per_page: options?.per_page, segment_id: options?.segment_id } });
  }
  async getUser(userId: string): Promise<CPUser> { return this.client.request<CPUser>(`/users/${userId}`); }
  async createOrUpdateUser(data: { email: string; name?: string; custom_attributes?: Record<string, unknown>; tags?: string[] }): Promise<CPUser> {
    return this.client.request<CPUser>('/users', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteUser(userId: string): Promise<void> { await this.client.request(`/users/${userId}`, { method: 'DELETE' }); }
  async tagUser(userId: string, tag: string): Promise<void> { await this.client.request(`/users/${userId}/tags`, { method: 'POST', body: { tag } }); }
  async untagUser(userId: string, tag: string): Promise<void> { await this.client.request(`/users/${userId}/tags/${tag}`, { method: 'DELETE' }); }

  async trackEvent(data: { user_id: string; name: string; properties?: Record<string, unknown> }): Promise<CPEvent> {
    return this.client.request<CPEvent>('/events', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listSegments(): Promise<CPSegment[]> { return this.client.request<CPSegment[]>('/segments'); }
  async listCampaigns(): Promise<CPCampaign[]> { return this.client.request<CPCampaign[]>('/campaigns'); }
  async listTags(): Promise<CPTag[]> { return this.client.request<CPTag[]>('/tags'); }

  getClient(): CrowdPowerClient { return this.client; }
}
