// Chatling Connector — AI chatbot builder for websites
import { ChatlingClient } from './client';
import type { ChatlingConfig, CLChatbot, CLConversation, CLDataSource, CLLead } from '../types';
export { ChatlingClient } from './client';

export class Chatling {
  private readonly client: ChatlingClient;
  constructor(config: ChatlingConfig) { this.client = new ChatlingClient(config); }
  static fromEnv(): Chatling {
    const apiKey = process.env.CHATLING_API_KEY;
    if (!apiKey) throw new Error('CHATLING_API_KEY is required');
    return new Chatling({ apiKey });
  }

  async listChatbots(): Promise<CLChatbot[]> { return this.client.request<CLChatbot[]>('/chatbots'); }
  async getChatbot(chatbotId: string): Promise<CLChatbot> { return this.client.request<CLChatbot>(`/chatbots/${chatbotId}`); }
  async createChatbot(data: { name: string; description?: string; model?: string; initial_message?: string }): Promise<CLChatbot> {
    return this.client.request<CLChatbot>('/chatbots', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateChatbot(chatbotId: string, data: { name?: string; description?: string; model?: string; initial_message?: string }): Promise<CLChatbot> {
    return this.client.request<CLChatbot>(`/chatbots/${chatbotId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteChatbot(chatbotId: string): Promise<void> { await this.client.request(`/chatbots/${chatbotId}`, { method: 'DELETE' }); }

  async sendMessage(chatbotId: string, message: string, visitorId?: string): Promise<{ response: string; conversation_id: string }> {
    return this.client.request(`/chatbots/${chatbotId}/chat`, { method: 'POST', body: { message, visitor_id: visitorId } });
  }

  async listConversations(chatbotId: string): Promise<CLConversation[]> { return this.client.request<CLConversation[]>(`/chatbots/${chatbotId}/conversations`); }
  async getConversation(conversationId: string): Promise<CLConversation> { return this.client.request<CLConversation>(`/conversations/${conversationId}`); }

  async listDataSources(chatbotId: string): Promise<CLDataSource[]> { return this.client.request<CLDataSource[]>(`/chatbots/${chatbotId}/data-sources`); }
  async addUrlSource(chatbotId: string, url: string): Promise<CLDataSource> {
    return this.client.request<CLDataSource>(`/chatbots/${chatbotId}/data-sources`, { method: 'POST', body: { type: 'url', url } });
  }
  async addTextSource(chatbotId: string, name: string, content: string): Promise<CLDataSource> {
    return this.client.request<CLDataSource>(`/chatbots/${chatbotId}/data-sources`, { method: 'POST', body: { type: 'text', name, content } });
  }
  async deleteDataSource(dataSourceId: string): Promise<void> { await this.client.request(`/data-sources/${dataSourceId}`, { method: 'DELETE' }); }

  async listLeads(chatbotId: string): Promise<CLLead[]> { return this.client.request<CLLead[]>(`/chatbots/${chatbotId}/leads`); }

  getClient(): ChatlingClient { return this.client; }
}
