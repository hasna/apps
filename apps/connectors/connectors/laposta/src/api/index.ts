// Laposta Connector — Email marketing and newsletter platform
import { LapostaClient } from './client';
import type { LapostaConfig, LPList, LPMember, LPMemberList, LPCampaign, LPWebhook } from '../types';
export { LapostaClient } from './client';

export class Laposta {
  private readonly client: LapostaClient;
  constructor(config: LapostaConfig) { this.client = new LapostaClient(config); }
  static fromEnv(): Laposta {
    const apiKey = process.env.LAPOSTA_API_KEY;
    if (!apiKey) throw new Error('LAPOSTA_API_KEY is required');
    return new Laposta({ apiKey });
  }

  async listLists(): Promise<{ data: { list: LPList }[] }> { return this.client.request('/list'); }
  async getList(listId: string): Promise<{ list: LPList }> { return this.client.request(`/list/${listId}`); }
  async createList(name: string, remarks?: string): Promise<{ list: LPList }> {
    return this.client.request('/list', { method: 'POST', body: { name, remarks } });
  }
  async deleteList(listId: string): Promise<void> { await this.client.request(`/list/${listId}`, { method: 'DELETE' }); }

  async listMembers(listId: string): Promise<LPMemberList> {
    return this.client.request<LPMemberList>('/member', { params: { list_id: listId } });
  }
  async getMember(listId: string, memberId: string): Promise<{ member: LPMember }> {
    return this.client.request(`/member/${memberId}`, { params: { list_id: listId } });
  }
  async addMember(listId: string, email: string, customFields?: Record<string, string>): Promise<{ member: LPMember }> {
    return this.client.request('/member', { method: 'POST', body: { list_id: listId, email, custom_fields: customFields } as Record<string, unknown> });
  }
  async updateMember(listId: string, memberId: string, data: { email?: string; custom_fields?: Record<string, string> }): Promise<{ member: LPMember }> {
    return this.client.request(`/member/${memberId}`, { method: 'POST', body: { list_id: listId, ...data } as Record<string, unknown> });
  }
  async deleteMember(listId: string, memberId: string): Promise<void> {
    await this.client.request(`/member/${memberId}`, { method: 'DELETE', body: { list_id: listId } });
  }

  async listCampaigns(): Promise<{ data: { campaign: LPCampaign }[] }> { return this.client.request('/campaign'); }

  async listWebhooks(listId: string): Promise<{ data: { webhook: LPWebhook }[] }> {
    return this.client.request('/webhook', { params: { list_id: listId } });
  }
  async createWebhook(listId: string, event: string, url: string): Promise<{ webhook: LPWebhook }> {
    return this.client.request('/webhook', { method: 'POST', body: { list_id: listId, event, url } });
  }

  getClient(): LapostaClient { return this.client; }
}
