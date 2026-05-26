// Personal AI Connector — Personal AI assistant with memory and knowledge base
import { PersonalAIClient } from './client';
import type { PersonalAIConfig, PAIMessage, PAIMemory, PAIMemoryList, PAIProfile, PAIDomain } from '../types';
export { PersonalAIClient } from './client';

export class PersonalAI {
  private readonly client: PersonalAIClient;
  constructor(config: PersonalAIConfig) { this.client = new PersonalAIClient(config); }
  static fromEnv(): PersonalAI {
    const apiKey = process.env.PERSONALAI_API_KEY;
    if (!apiKey) throw new Error('PERSONALAI_API_KEY is required');
    return new PersonalAI({ apiKey });
  }

  async sendMessage(text: string, options?: { domain_name?: string; context?: string }): Promise<PAIMessage> {
    return this.client.request<PAIMessage>('/message', { method: 'POST', body: { Text: text, DomainName: options?.domain_name, Context: options?.context } as Record<string, unknown> });
  }

  async createMemory(text: string, options?: { source_name?: string; domain_name?: string; created_time?: string }): Promise<{ status: string }> {
    return this.client.request('/memory', { method: 'POST', body: { Text: text, SourceName: options?.source_name, DomainName: options?.domain_name, CreatedTime: options?.created_time } as Record<string, unknown> });
  }
  async listMemories(options?: { page?: number; per_page?: number }): Promise<PAIMemoryList> {
    return this.client.request<PAIMemoryList>('/memory', { params: { page: options?.page, per_page: options?.per_page } });
  }

  async getProfile(): Promise<PAIProfile> { return this.client.request<PAIProfile>('/profile'); }

  async listDomains(): Promise<PAIDomain[]> { return this.client.request<PAIDomain[]>('/domains'); }
  async createDomain(name: string, description?: string): Promise<PAIDomain> {
    return this.client.request<PAIDomain>('/domains', { method: 'POST', body: { name, description } });
  }

  getClient(): PersonalAIClient { return this.client; }
}
