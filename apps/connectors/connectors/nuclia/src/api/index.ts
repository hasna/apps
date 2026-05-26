// Nuclia Connector — AI-powered search and knowledge base (RAG)
import { NucliaClient } from './client';
import type { NucliaConfig, NucliaResource, NucliaResourceList, NucliaSearchResult, NucliaLabelSet } from '../types';
export { NucliaClient } from './client';

export class Nuclia {
  private readonly client: NucliaClient;
  constructor(config: NucliaConfig) { this.client = new NucliaClient(config); }
  static fromEnv(): Nuclia {
    const serviceToken = process.env.NUCLIA_SERVICE_TOKEN;
    const zone = process.env.NUCLIA_ZONE;
    const kbId = process.env.NUCLIA_KB_ID;
    if (!serviceToken || !zone || !kbId) throw new Error('NUCLIA_SERVICE_TOKEN, NUCLIA_ZONE, and NUCLIA_KB_ID are required');
    return new Nuclia({ serviceToken, zone, kbId });
  }

  async search(query: string, options?: { page_size?: number; features?: string[] }): Promise<NucliaSearchResult> {
    return this.client.request<NucliaSearchResult>('/search', { method: 'POST', body: { query, page_size: options?.page_size, features: options?.features } as Record<string, unknown> });
  }

  async ask(question: string, options?: { context?: string[]; features?: string[] }): Promise<{ answer: string; sources: { id: string; text: string }[] }> {
    return this.client.request('/ask', { method: 'POST', body: { query: question, context: options?.context, features: options?.features } as Record<string, unknown> });
  }

  async listResources(options?: { page?: number; size?: number }): Promise<NucliaResourceList> {
    return this.client.request<NucliaResourceList>('/resources', { params: { page: options?.page, size: options?.size } });
  }
  async getResource(resourceId: string): Promise<NucliaResource> { return this.client.request<NucliaResource>(`/resource/${resourceId}`); }
  async createResource(data: { title: string; slug?: string; summary?: string; texts?: Record<string, { body: string; format: string }> }): Promise<NucliaResource> {
    return this.client.request<NucliaResource>('/resources', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateResource(resourceId: string, data: { title?: string; summary?: string; texts?: Record<string, { body: string; format: string }> }): Promise<NucliaResource> {
    return this.client.request<NucliaResource>(`/resource/${resourceId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteResource(resourceId: string): Promise<void> { await this.client.request(`/resource/${resourceId}`, { method: 'DELETE' }); }

  async listLabelSets(): Promise<{ labelsets: Record<string, NucliaLabelSet> }> { return this.client.request('/labelsets'); }

  getClient(): NucliaClient { return this.client; }
}
