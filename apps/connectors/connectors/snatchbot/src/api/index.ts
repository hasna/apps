// SnatchBot Connector — Multi-channel chatbot building and automation
import { SnatchBotClient } from './client';
import type { SnatchBotConfig, SBBot, SBConversation, SBUser, SBBroadcast } from '../types';
export { SnatchBotClient } from './client';

export class SnatchBot {
  private readonly client: SnatchBotClient;
  constructor(config: SnatchBotConfig) { this.client = new SnatchBotClient(config); }
  static fromEnv(): SnatchBot {
    const token = process.env.SNATCHBOT_TOKEN;
    if (!token) throw new Error('SNATCHBOT_TOKEN is required');
    return new SnatchBot({ token });
  }

  async listBots(): Promise<SBBot[]> { return this.client.request<SBBot[]>('/bots'); }
  async getBot(botId: string): Promise<SBBot> { return this.client.request<SBBot>(`/bots/${botId}`); }

  async sendMessage(botId: string, userId: string, message: string, channel?: string): Promise<{ response: string }> {
    return this.client.request(`/bots/${botId}/message`, { method: 'POST', body: { user_id: userId, message, channel } });
  }

  async listConversations(botId: string, options?: { page?: number }): Promise<SBConversation[]> {
    return this.client.request<SBConversation[]>(`/bots/${botId}/conversations`, { params: { page: options?.page } });
  }

  async listUsers(botId: string, options?: { page?: number }): Promise<SBUser[]> {
    return this.client.request<SBUser[]>(`/bots/${botId}/users`, { params: { page: options?.page } });
  }
  async getUser(botId: string, userId: string): Promise<SBUser> { return this.client.request<SBUser>(`/bots/${botId}/users/${userId}`); }

  async listBroadcasts(botId: string): Promise<SBBroadcast[]> { return this.client.request<SBBroadcast[]>(`/bots/${botId}/broadcasts`); }

  getClient(): SnatchBotClient { return this.client; }
}
