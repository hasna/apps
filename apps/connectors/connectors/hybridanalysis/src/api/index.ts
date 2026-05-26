// Hybrid Analysis Connector — Malware analysis and threat detection sandbox
import { HybridAnalysisClient } from './client';
import type { HybridAnalysisConfig, HAReport, HASearchResult, HAOverview, HAQuota } from '../types';
export { HybridAnalysisClient } from './client';

export class HybridAnalysis {
  private readonly client: HybridAnalysisClient;
  constructor(config: HybridAnalysisConfig) { this.client = new HybridAnalysisClient(config); }
  static fromEnv(): HybridAnalysis {
    const apiKey = process.env.HYBRIDANALYSIS_API_KEY;
    if (!apiKey) throw new Error('HYBRIDANALYSIS_API_KEY is required');
    return new HybridAnalysis({ apiKey });
  }

  async getReport(hash: string): Promise<HAReport[]> { return this.client.request<HAReport[]>(`/report/${hash}/summary`); }
  async getOverview(hash: string): Promise<HAOverview> { return this.client.request<HAOverview>(`/overview/${hash}`); }

  async searchHash(hash: string): Promise<HASearchResult> {
    return this.client.request<HASearchResult>('/search/hash', { method: 'POST', body: { hash }, form: true });
  }
  async searchTerms(query: string): Promise<HASearchResult> {
    return this.client.request<HASearchResult>('/search/terms', { method: 'POST', body: { filename: query }, form: true });
  }

  async quickScanUrl(url: string, options?: { scan_type?: string }): Promise<{ id: string; sha256: string }> {
    return this.client.request('/quick-scan/url', { method: 'POST', body: { url, scan_type: options?.scan_type || 'all' }, form: true });
  }

  async getQuota(): Promise<HAQuota> { return this.client.request<HAQuota>('/key/current'); }

  getClient(): HybridAnalysisClient { return this.client; }
}
