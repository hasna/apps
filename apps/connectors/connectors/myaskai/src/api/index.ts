// My AskAI Connector — Custom AI assistant builder for knowledge bases
import { MyAskAIClient } from './client';
import type { MyAskAIConfig, MAAssistant, MAConversation, MADataSource } from '../types';
export { MyAskAIClient } from './client';

export class MyAskAI {
  private readonly client: MyAskAIClient;
  constructor(config: MyAskAIConfig) { this.client = new MyAskAIClient(config); }
  static fromEnv(): MyAskAI {
    const apiKey = process.env.MYASKAI_API_KEY;
    if (!apiKey) throw new Error('MYASKAI_API_KEY is required');
    return new MyAskAI({ apiKey });
  }

  async listAssistants(): Promise<MAAssistant[]> { return this.client.request<MAAssistant[]>('/assistants'); }
  async getAssistant(assistantId: string): Promise<MAAssistant> { return this.client.request<MAAssistant>(`/assistants/${assistantId}`); }

  async ask(assistantId: string, question: string, options?: { conversation_id?: string }): Promise<{ answer: string; sources: { title: string; url: string }[]; conversation_id: string }> {
    return this.client.request(`/assistants/${assistantId}/ask`, { method: 'POST', body: { question, conversation_id: options?.conversation_id } as Record<string, unknown> });
  }

  async listConversations(assistantId: string): Promise<MAConversation[]> {
    return this.client.request<MAConversation[]>(`/assistants/${assistantId}/conversations`);
  }

  async listDataSources(assistantId: string): Promise<MADataSource[]> {
    return this.client.request<MADataSource[]>(`/assistants/${assistantId}/data-sources`);
  }
  async addUrlSource(assistantId: string, url: string): Promise<MADataSource> {
    return this.client.request<MADataSource>(`/assistants/${assistantId}/data-sources`, { method: 'POST', body: { type: 'url', url } });
  }
  async deleteDataSource(assistantId: string, dataSourceId: string): Promise<void> {
    await this.client.request(`/assistants/${assistantId}/data-sources/${dataSourceId}`, { method: 'DELETE' });
  }

  getClient(): MyAskAIClient { return this.client; }
}
