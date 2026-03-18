// SiteSpeak AI Connector — AI chatbot and customer support for websites
import { SiteSpeakAIClient } from './client';
import type { SiteSpeakAIConfig, SSChatbot, SSConversation, SSDataSource, SSAnalytics } from '../types';
export { SiteSpeakAIClient } from './client';

export class SiteSpeakAI {
  private readonly client: SiteSpeakAIClient;
  constructor(config: SiteSpeakAIConfig) { this.client = new SiteSpeakAIClient(config); }
  static fromEnv(): SiteSpeakAI {
    const apiKey = process.env.SITESPEAKAI_API_KEY;
    if (!apiKey) throw new Error('SITESPEAKAI_API_KEY is required');
    return new SiteSpeakAI({ apiKey });
  }

  async listChatbots(): Promise<SSChatbot[]> { return this.client.request<SSChatbot[]>('/chatbots'); }
  async getChatbot(chatbotId: string): Promise<SSChatbot> { return this.client.request<SSChatbot>(`/chatbots/${chatbotId}`); }

  async ask(chatbotId: string, question: string, visitorId?: string): Promise<{ answer: string; sources: { title: string; url: string }[]; conversation_id: string }> {
    return this.client.request(`/chatbots/${chatbotId}/ask`, { method: 'POST', body: { question, visitor_id: visitorId } as Record<string, unknown> });
  }

  async listConversations(chatbotId: string, options?: { page?: number }): Promise<SSConversation[]> {
    return this.client.request<SSConversation[]>(`/chatbots/${chatbotId}/conversations`, { params: { page: options?.page } });
  }

  async listDataSources(chatbotId: string): Promise<SSDataSource[]> { return this.client.request<SSDataSource[]>(`/chatbots/${chatbotId}/data-sources`); }
  async addUrlSource(chatbotId: string, url: string): Promise<SSDataSource> {
    return this.client.request<SSDataSource>(`/chatbots/${chatbotId}/data-sources`, { method: 'POST', body: { type: 'url', url } });
  }
  async deleteDataSource(chatbotId: string, dataSourceId: string): Promise<void> {
    await this.client.request(`/chatbots/${chatbotId}/data-sources/${dataSourceId}`, { method: 'DELETE' });
  }

  async getAnalytics(chatbotId: string, options?: { from?: string; to?: string }): Promise<SSAnalytics> {
    return this.client.request<SSAnalytics>(`/chatbots/${chatbotId}/analytics`, { params: { from: options?.from, to: options?.to } });
  }

  getClient(): SiteSpeakAIClient { return this.client; }
}
