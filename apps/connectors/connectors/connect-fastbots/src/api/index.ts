// Fastbots Connector — AI chatbot builder for websites and support
import { FastbotsClient } from './client';
import type { FastbotsConfig, FBBot, FBConversation, FBDataSource, FBLead } from '../types';
export { FastbotsClient } from './client';

export class Fastbots {
  private readonly client: FastbotsClient;
  constructor(config: FastbotsConfig) { this.client = new FastbotsClient(config); }
  static fromEnv(): Fastbots {
    const apiKey = process.env.FASTBOTS_API_KEY;
    if (!apiKey) throw new Error('FASTBOTS_API_KEY is required');
    return new Fastbots({ apiKey });
  }

  async listBots(): Promise<FBBot[]> { return this.client.request<FBBot[]>('/bots'); }
  async getBot(botId: string): Promise<FBBot> { return this.client.request<FBBot>(`/bots/${botId}`); }
  async updateBot(botId: string, data: { name?: string; description?: string; system_prompt?: string; model?: string; temperature?: number }): Promise<FBBot> {
    return this.client.request<FBBot>(`/bots/${botId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }

  async chat(botId: string, message: string, options?: { conversation_id?: string; visitor_id?: string }): Promise<{ response: string; conversation_id: string }> {
    return this.client.request(`/bots/${botId}/chat`, { method: 'POST', body: { message, conversation_id: options?.conversation_id, visitor_id: options?.visitor_id } });
  }

  async listConversations(botId: string): Promise<FBConversation[]> { return this.client.request<FBConversation[]>(`/bots/${botId}/conversations`); }
  async getConversation(conversationId: string): Promise<FBConversation> { return this.client.request<FBConversation>(`/conversations/${conversationId}`); }

  async listDataSources(botId: string): Promise<FBDataSource[]> { return this.client.request<FBDataSource[]>(`/bots/${botId}/data-sources`); }
  async addUrlSource(botId: string, url: string): Promise<FBDataSource> {
    return this.client.request<FBDataSource>(`/bots/${botId}/data-sources`, { method: 'POST', body: { type: 'url', url } });
  }
  async addTextSource(botId: string, name: string, content: string): Promise<FBDataSource> {
    return this.client.request<FBDataSource>(`/bots/${botId}/data-sources`, { method: 'POST', body: { type: 'text', name, content } });
  }
  async deleteDataSource(dataSourceId: string): Promise<void> { await this.client.request(`/data-sources/${dataSourceId}`, { method: 'DELETE' }); }

  async listLeads(botId: string): Promise<FBLead[]> { return this.client.request<FBLead[]>(`/bots/${botId}/leads`); }

  getClient(): FastbotsClient { return this.client; }
}
