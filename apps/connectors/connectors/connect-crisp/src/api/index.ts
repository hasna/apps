// Crisp Connector — Customer messaging and live chat
import { CrispClient } from './client';
import type { CrispConfig, CRConversation, CRMessage, CRPeople } from '../types';
export { CrispClient } from './client';

export class Crisp {
  private readonly client: CrispClient;
  constructor(config: CrispConfig) { this.client = new CrispClient(config); }
  static fromEnv(): Crisp {
    const websiteId = process.env.CRISP_WEBSITE_ID;
    const tokenId = process.env.CRISP_TOKEN_ID;
    const tokenKey = process.env.CRISP_TOKEN_KEY;
    if (!websiteId || !tokenId || !tokenKey) throw new Error('CRISP_WEBSITE_ID, CRISP_TOKEN_ID, and CRISP_TOKEN_KEY are required');
    return new Crisp({ websiteId, tokenId, tokenKey });
  }

  async listConversations(options?: { page_number?: number }): Promise<CRConversation[]> {
    return this.client.request<CRConversation[]>(`/website/${this.client.getWebsiteId()}/conversations/${options?.page_number || 1}`);
  }
  async getConversation(sessionId: string): Promise<CRConversation> {
    return this.client.request<CRConversation>(`/website/${this.client.getWebsiteId()}/conversation/${sessionId}`);
  }

  async getMessages(sessionId: string): Promise<CRMessage[]> {
    return this.client.request<CRMessage[]>(`/website/${this.client.getWebsiteId()}/conversation/${sessionId}/messages`);
  }
  async sendMessage(sessionId: string, content: string, type?: string): Promise<void> {
    await this.client.request(`/website/${this.client.getWebsiteId()}/conversation/${sessionId}/message`, { method: 'POST', body: { type: type || 'text', content, from: 'operator', origin: 'chat' } });
  }

  async resolveConversation(sessionId: string): Promise<void> {
    await this.client.request(`/website/${this.client.getWebsiteId()}/conversation/${sessionId}/state`, { method: 'PATCH', body: { state: 'resolved' } });
  }

  async getPeople(peopleId: string): Promise<CRPeople> {
    return this.client.request<CRPeople>(`/website/${this.client.getWebsiteId()}/people/profile/${peopleId}`);
  }
  async searchPeople(searchText: string): Promise<CRPeople[]> {
    return this.client.request<CRPeople[]>(`/website/${this.client.getWebsiteId()}/people/profiles/1`, { params: { search_text: searchText } });
  }

  getClient(): CrispClient { return this.client; }
}
