// Shuffler Connector — Security automation and SOAR workflow orchestration
import { ShufflerClient } from './client';
import type { ShufflerConfig, SHWorkflow, SHExecution, SHApp } from '../types';
export { ShufflerClient } from './client';

export class Shuffler {
  private readonly client: ShufflerClient;
  constructor(config: ShufflerConfig) { this.client = new ShufflerClient(config); }
  static fromEnv(): Shuffler {
    const apiKey = process.env.SHUFFLER_API_KEY;
    if (!apiKey) throw new Error('SHUFFLER_API_KEY is required');
    return new Shuffler({ apiKey, baseUrl: process.env.SHUFFLER_BASE_URL });
  }

  async listWorkflows(): Promise<SHWorkflow[]> { return this.client.request<SHWorkflow[]>('/workflows'); }
  async getWorkflow(workflowId: string): Promise<SHWorkflow> { return this.client.request<SHWorkflow>(`/workflows/${workflowId}`); }
  async executeWorkflow(workflowId: string, data?: Record<string, unknown>): Promise<SHExecution> {
    return this.client.request<SHExecution>(`/workflows/${workflowId}/execute`, { method: 'POST', body: data || {} });
  }
  async stopExecution(executionId: string): Promise<void> {
    await this.client.request(`/workflows/executions/${executionId}/abort`, { method: 'GET' });
  }

  async listExecutions(workflowId: string): Promise<SHExecution[]> {
    return this.client.request<SHExecution[]>(`/workflows/${workflowId}/executions`);
  }
  async getExecution(executionId: string): Promise<SHExecution> {
    return this.client.request<SHExecution>(`/workflows/executions/${executionId}`);
  }

  async listApps(): Promise<SHApp[]> { return this.client.request<SHApp[]>('/apps'); }
  async getApp(appId: string): Promise<SHApp> { return this.client.request<SHApp>(`/apps/${appId}`); }
  async searchApps(query: string): Promise<SHApp[]> { return this.client.request<SHApp[]>('/apps/search', { params: { q: query } }); }

  getClient(): ShufflerClient { return this.client; }
}
