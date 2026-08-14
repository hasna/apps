// Malcore Connector — Malware analysis and threat detection
import { MalcoreClient } from './client';
import type { MalcoreConfig, MCAnalysis, MCUrlAnalysis, MCQuota } from '../types';
export { MalcoreClient } from './client';

export class Malcore {
  private readonly client: MalcoreClient;
  constructor(config: MalcoreConfig) { this.client = new MalcoreClient(config); }
  static fromEnv(): Malcore {
    const apiKey = process.env.MALCORE_API_KEY;
    if (!apiKey) throw new Error('MALCORE_API_KEY is required');
    return new Malcore({ apiKey });
  }

  async analyzeHash(sha256: string): Promise<MCAnalysis> {
    return this.client.request<MCAnalysis>('/scan/hash', { method: 'POST', body: { sha256 } });
  }

  async getAnalysis(analysisId: string): Promise<MCAnalysis> {
    return this.client.request<MCAnalysis>(`/scan/${analysisId}`);
  }

  async analyzeUrl(url: string): Promise<MCUrlAnalysis> {
    return this.client.request<MCUrlAnalysis>('/scan/url', { method: 'POST', body: { url } });
  }

  async getUrlAnalysis(analysisId: string): Promise<MCUrlAnalysis> {
    return this.client.request<MCUrlAnalysis>(`/scan/url/${analysisId}`);
  }

  async searchHash(sha256: string): Promise<MCAnalysis | null> {
    return this.client.request<MCAnalysis | null>(`/search/hash/${sha256}`);
  }

  async getQuota(): Promise<MCQuota> { return this.client.request<MCQuota>('/quota'); }

  getClient(): MalcoreClient { return this.client; }
}
