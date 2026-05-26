// DocsBot AI Connector — AI-powered documentation chatbot
import { DocsBotClient } from './client';
import type { DocsBotConfig, DBBot, DBSource, DBAnswer, DBConversation } from '../types';
export { DocsBotClient } from './client';

export class DocsBot {
  private readonly client: DocsBotClient;
  constructor(config: DocsBotConfig) { this.client = new DocsBotClient(config); }
  static fromEnv(): DocsBot {
    const apiKey = process.env.DOCSBOT_API_KEY;
    if (!apiKey) throw new Error('DOCSBOT_API_KEY environment variable is required');
    return new DocsBot({ apiKey, teamId: process.env.DOCSBOT_TEAM_ID });
  }

  /** List all bots */
  async listBots(): Promise<DBBot[]> {
    const r = await this.client.request<{ bots: DBBot[] }>('/bots');
    return r.bots ?? [];
  }

  /** Get a bot by ID */
  async getBot(botId: string): Promise<DBBot> {
    return this.client.request<DBBot>(`/bots/${botId}`);
  }

  /** Ask a question to a bot */
  async ask(botId: string, question: string, options?: { history?: Array<{ role: string; content: string }>; full_source?: boolean }): Promise<DBAnswer> {
    return this.client.request<DBAnswer>(`/bots/${botId}/ask`, {
      method: 'POST',
      body: { question, ...options },
    });
  }

  /** Chat with a bot (maintains conversation) */
  async chat(botId: string, question: string, conversationId?: string): Promise<DBAnswer & { conversation_id: string }> {
    return this.client.request(`/bots/${botId}/chat`, {
      method: 'POST',
      body: { question, conversation_id: conversationId },
    });
  }

  /** List sources for a bot */
  async listSources(botId: string): Promise<DBSource[]> {
    const r = await this.client.request<{ sources: DBSource[] }>(`/bots/${botId}/sources`);
    return r.sources ?? [];
  }

  /** Add a URL source to a bot */
  async addUrlSource(botId: string, url: string, options?: { name?: string; depth?: number }): Promise<DBSource> {
    return this.client.request<DBSource>(`/bots/${botId}/sources`, {
      method: 'POST',
      body: { type: 'url', url, name: options?.name || url, depth: options?.depth ?? 1 },
    });
  }

  /** Delete a source */
  async deleteSource(botId: string, sourceId: string): Promise<void> {
    await this.client.request(`/bots/${botId}/sources/${sourceId}`, { method: 'DELETE' });
  }

  /** Get conversation history */
  async getConversation(botId: string, conversationId: string): Promise<DBConversation> {
    return this.client.request<DBConversation>(`/bots/${botId}/conversations/${conversationId}`);
  }

  getClient(): DocsBotClient { return this.client; }
}
