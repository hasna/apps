// Cody Connector — AI coding assistant by Sourcegraph
import { CodyClient } from './client';
import type { CodyConfig, CodyCompletion, CodySearchResult, CodyRepository } from '../types';
export { CodyClient } from './client';

export class Cody {
  private readonly client: CodyClient;
  constructor(config: CodyConfig) { this.client = new CodyClient(config); }
  static fromEnv(): Cody {
    const token = process.env.SOURCEGRAPH_TOKEN;
    if (!token) throw new Error('SOURCEGRAPH_TOKEN is required');
    return new Cody({ token, endpoint: process.env.SOURCEGRAPH_ENDPOINT });
  }

  async complete(prompt: string, options?: { model?: string; maxTokensToSample?: number; temperature?: number; stopSequences?: string[] }): Promise<CodyCompletion> {
    return this.client.request<CodyCompletion>('/.api/completions/stream', { method: 'POST', body: { messages: [{ speaker: 'human', text: prompt }], model: options?.model, maxTokensToSample: options?.maxTokensToSample || 1000, temperature: options?.temperature || 0, stopSequences: options?.stopSequences } as Record<string, unknown> });
  }

  async chat(messages: { speaker: 'human' | 'assistant'; text: string }[], options?: { model?: string; maxTokensToSample?: number; temperature?: number }): Promise<CodyCompletion> {
    return this.client.request<CodyCompletion>('/.api/completions/stream', { method: 'POST', body: { messages, model: options?.model, maxTokensToSample: options?.maxTokensToSample || 4000, temperature: options?.temperature || 0 } as Record<string, unknown> });
  }

  async searchCode(query: string): Promise<CodySearchResult> {
    return this.client.request<CodySearchResult>('/.api/search/stream', { params: { q: query } });
  }

  async listRepositories(options?: { query?: string; first?: number }): Promise<{ nodes: CodyRepository[] }> {
    return this.client.request('/.api/repos', { params: { q: options?.query, first: options?.first } });
  }

  getClient(): CodyClient { return this.client; }
}
