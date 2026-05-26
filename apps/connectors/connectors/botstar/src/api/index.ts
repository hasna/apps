// BotStar Connector — Visual chatbot builder and automation
import { BotStarClient } from './client';
import type { BotStarConfig, BSBot, BSFlow, BSSubscriber, BSSubscriberList, BSBroadcast, BSConversation } from '../types';
export { BotStarClient } from './client';

export class BotStar {
  private readonly client: BotStarClient;
  constructor(config: BotStarConfig) { this.client = new BotStarClient(config); }
  static fromEnv(): BotStar {
    const token = process.env.BOTSTAR_TOKEN;
    if (!token) throw new Error('BOTSTAR_TOKEN is required');
    return new BotStar({ token });
  }

  async listBots(): Promise<BSBot[]> { return this.client.request<BSBot[]>('/bots'); }
  async getBot(botId: string): Promise<BSBot> { return this.client.request<BSBot>(`/bots/${botId}`); }

  async listFlows(botId: string): Promise<BSFlow[]> { return this.client.request<BSFlow[]>(`/bots/${botId}/flows`); }

  async listSubscribers(botId: string, options?: { page?: number; per_page?: number; tag?: string }): Promise<BSSubscriberList> {
    return this.client.request<BSSubscriberList>(`/bots/${botId}/subscribers`, { params: { page: options?.page, per_page: options?.per_page, tag: options?.tag } });
  }
  async getSubscriber(botId: string, subscriberId: string): Promise<BSSubscriber> {
    return this.client.request<BSSubscriber>(`/bots/${botId}/subscribers/${subscriberId}`);
  }
  async tagSubscriber(botId: string, subscriberId: string, tag: string): Promise<void> {
    await this.client.request(`/bots/${botId}/subscribers/${subscriberId}/tags`, { method: 'POST', body: { tag } });
  }
  async untagSubscriber(botId: string, subscriberId: string, tag: string): Promise<void> {
    await this.client.request(`/bots/${botId}/subscribers/${subscriberId}/tags/${tag}`, { method: 'DELETE' });
  }

  async sendMessage(botId: string, subscriberId: string, message: string): Promise<void> {
    await this.client.request(`/bots/${botId}/subscribers/${subscriberId}/messages`, { method: 'POST', body: { message } });
  }

  async listBroadcasts(botId: string): Promise<BSBroadcast[]> { return this.client.request<BSBroadcast[]>(`/bots/${botId}/broadcasts`); }

  async getConversation(botId: string, subscriberId: string): Promise<BSConversation> {
    return this.client.request<BSConversation>(`/bots/${botId}/subscribers/${subscriberId}/conversation`);
  }

  getClient(): BotStarClient { return this.client; }
}
