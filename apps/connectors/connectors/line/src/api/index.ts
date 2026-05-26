// LINE Connector — LINE messaging platform and bot API
import { LINEClient } from './client';
import type { LINEConfig, LINEProfile, LINEMessage, LINESendResult, LINERichMenu, LINEGroupSummary, LINEQuota } from '../types';
export { LINEClient } from './client';

export class LINE {
  private readonly client: LINEClient;
  constructor(config: LINEConfig) { this.client = new LINEClient(config); }
  static fromEnv(): LINE {
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!channelAccessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is required');
    return new LINE({ channelAccessToken });
  }

  async pushMessage(to: string, messages: LINEMessage[]): Promise<LINESendResult> {
    return this.client.request<LINESendResult>('/message/push', { method: 'POST', body: { to, messages } as Record<string, unknown> });
  }
  async replyMessage(replyToken: string, messages: LINEMessage[]): Promise<LINESendResult> {
    return this.client.request<LINESendResult>('/message/reply', { method: 'POST', body: { replyToken, messages } as Record<string, unknown> });
  }
  async broadcastMessage(messages: LINEMessage[]): Promise<LINESendResult> {
    return this.client.request<LINESendResult>('/message/broadcast', { method: 'POST', body: { messages } as Record<string, unknown> });
  }
  async multicastMessage(to: string[], messages: LINEMessage[]): Promise<LINESendResult> {
    return this.client.request<LINESendResult>('/message/multicast', { method: 'POST', body: { to, messages } as Record<string, unknown> });
  }

  async getProfile(userId: string): Promise<LINEProfile> { return this.client.request<LINEProfile>(`/profile/${userId}`); }

  async getGroupSummary(groupId: string): Promise<LINEGroupSummary> { return this.client.request<LINEGroupSummary>(`/group/${groupId}/summary`); }
  async getGroupMemberCount(groupId: string): Promise<{ count: number }> { return this.client.request(`/group/${groupId}/members/count`); }
  async leaveGroup(groupId: string): Promise<void> { await this.client.request(`/group/${groupId}/leave`, { method: 'POST' }); }

  async listRichMenus(): Promise<{ richmenus: LINERichMenu[] }> { return this.client.request('/richmenu/list'); }
  async getRichMenu(richMenuId: string): Promise<LINERichMenu> { return this.client.request<LINERichMenu>(`/richmenu/${richMenuId}`); }

  async getMessageQuota(): Promise<LINEQuota> { return this.client.request<LINEQuota>('/message/quota'); }
  async getMessageQuotaConsumption(): Promise<{ totalUsage: number }> { return this.client.request('/message/quota/consumption'); }

  getClient(): LINEClient { return this.client; }
}
