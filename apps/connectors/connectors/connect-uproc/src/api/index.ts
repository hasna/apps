// uProc Connector — Data processing and enrichment tools
import { UProcClient } from './client';
import type { UProcConfig, UProcTool, UProcResult, UProcBatchJob, UProcCredits } from '../types';
export { UProcClient } from './client';

export class UProc {
  private readonly client: UProcClient;
  constructor(config: UProcConfig) { this.client = new UProcClient(config); }
  static fromEnv(): UProc {
    const apiKey = process.env.UPROC_API_KEY;
    if (!apiKey) throw new Error('UPROC_API_KEY is required');
    return new UProc({ apiKey });
  }

  async listTools(options?: { category?: string }): Promise<UProcTool[]> {
    return this.client.request<UProcTool[]>('/tools', { params: { category: options?.category } });
  }
  async getTool(toolId: string): Promise<UProcTool> { return this.client.request<UProcTool>(`/tools/${toolId}`); }

  async runTool(toolId: string, params: Record<string, unknown>): Promise<UProcResult> {
    return this.client.request<UProcResult>(`/tools/${toolId}/run`, { method: 'POST', body: params });
  }

  async createBatchJob(toolId: string, data: Record<string, unknown>[]): Promise<UProcBatchJob> {
    return this.client.request<UProcBatchJob>(`/tools/${toolId}/batch`, { method: 'POST', body: { data } as Record<string, unknown> });
  }
  async getBatchJob(jobId: string): Promise<UProcBatchJob> { return this.client.request<UProcBatchJob>(`/batch/${jobId}`); }
  async listBatchJobs(): Promise<UProcBatchJob[]> { return this.client.request<UProcBatchJob[]>('/batch'); }

  async getCredits(): Promise<UProcCredits> { return this.client.request<UProcCredits>('/credits'); }

  getClient(): UProcClient { return this.client; }
}
