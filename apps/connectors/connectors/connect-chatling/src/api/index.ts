// Chatling Connector — AI chatbot builder for websites
import { ChatlingClient } from './client';
import type { ChatlingConfig, Chatbot, Conversation, SendMessageResult } from '../types';
export { ChatlingClient } from './client';

export class Chatling {
  private readonly client: ChatlingClient;
  constructor(config: ChatlingConfig) { this.client = new ChatlingClient(config); }

  static fromEnv(): Chatling {
    const apiKey = process.env.CHATLING_API_KEY;
    if (!apiKey) throw new Error('CHATLING_API_KEY environment variable is required');
    return new Chatling({ apiKey });
  }

  async listChatbots(): Promise<Chatbot[]> {
    const r = await this.client.request<{ data: Chatbot[] }>('/chatbots');
    return r.data ?? [];
  }

  async getChatbot(chatbotId: string): Promise<Chatbot> {
    return this.client.request<Chatbot>(`/chatbots/${chatbotId}`);
  }

  async sendMessage(chatbotId: string, message: string, conversationId?: string): Promise<SendMessageResult> {
    return this.client.request<SendMessageResult>(`/chatbots/${chatbotId}/chat`, {
      method: 'POST',
      body: { message, conversation_id: conversationId },
    });
  }

  async getConversation(chatbotId: string, conversationId: string): Promise<Conversation> {
    return this.client.request<Conversation>(`/chatbots/${chatbotId}/conversations/${conversationId}`);
  }

  async listConversations(chatbotId: string, options?: { page?: number; limit?: number }): Promise<Conversation[]> {
    const r = await this.client.request<{ data: Conversation[] }>(`/chatbots/${chatbotId}/conversations`, {
      params: options as Record<string, number | undefined>,
    });
    return r.data ?? [];
  }

  getClient(): ChatlingClient { return this.client; }
}
