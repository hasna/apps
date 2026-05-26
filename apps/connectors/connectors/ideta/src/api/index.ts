// Ideta Connector — No-code chatbot builder
import { IdetaClient } from './client';
import type { IdetaConfig, IDBot, IDConversation, IDUser, IDIntent } from '../types';
export { IdetaClient } from './client';

export class Ideta {
  private readonly client: IdetaClient;
  constructor(config: IdetaConfig) { this.client = new IdetaClient(config); }
  static fromEnv(): Ideta {
    const apiKey = process.env.IDETA_API_KEY;
    if (!apiKey) throw new Error('IDETA_API_KEY is required');
    return new Ideta({ apiKey });
  }

  async listBots(): Promise<IDBot[]> { return this.client.request<IDBot[]>('/bots'); }
  async getBot(botId: string): Promise<IDBot> { return this.client.request<IDBot>(`/bots/${botId}`); }

  async sendMessage(botId: string, userId: string, message: string): Promise<{ response: string }> {
    return this.client.request(`/bots/${botId}/message`, { method: 'POST', body: { user_id: userId, message } });
  }

  async listConversations(botId: string, options?: { page?: number }): Promise<IDConversation[]> {
    return this.client.request<IDConversation[]>(`/bots/${botId}/conversations`, { params: { page: options?.page } });
  }

  async listUsers(botId: string, options?: { page?: number; tag?: string }): Promise<IDUser[]> {
    return this.client.request<IDUser[]>(`/bots/${botId}/users`, { params: { page: options?.page, tag: options?.tag } });
  }
  async getUser(botId: string, userId: string): Promise<IDUser> { return this.client.request<IDUser>(`/bots/${botId}/users/${userId}`); }

  async listIntents(botId: string): Promise<IDIntent[]> { return this.client.request<IDIntent[]>(`/bots/${botId}/intents`); }

  getClient(): IdetaClient { return this.client; }
}
