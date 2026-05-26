// Thoughtful GPT Connector — AI-powered healthcare automation
import { ThoughtfulGPTClient } from './client';
import type { ThoughtfulGPTConfig, TGAutomation, TGRun, TGRunList, TGAgent } from '../types';
export { ThoughtfulGPTClient } from './client';

export class ThoughtfulGPT {
  private readonly client: ThoughtfulGPTClient;
  constructor(config: ThoughtfulGPTConfig) { this.client = new ThoughtfulGPTClient(config); }
  static fromEnv(): ThoughtfulGPT {
    const apiKey = process.env.THOUGHTFULGPT_API_KEY;
    if (!apiKey) throw new Error('THOUGHTFULGPT_API_KEY is required');
    return new ThoughtfulGPT({ apiKey });
  }

  async listAutomations(): Promise<TGAutomation[]> { return this.client.request<TGAutomation[]>('/automations'); }
  async getAutomation(automationId: string): Promise<TGAutomation> { return this.client.request<TGAutomation>(`/automations/${automationId}`); }

  async runAutomation(automationId: string, input: Record<string, unknown>): Promise<TGRun> {
    return this.client.request<TGRun>(`/automations/${automationId}/runs`, { method: 'POST', body: { input } });
  }
  async getRun(runId: string): Promise<TGRun> { return this.client.request<TGRun>(`/runs/${runId}`); }
  async listRuns(automationId: string, options?: { page?: number; per_page?: number; status?: string }): Promise<TGRunList> {
    return this.client.request<TGRunList>(`/automations/${automationId}/runs`, { params: { page: options?.page, per_page: options?.per_page, status: options?.status } });
  }

  async listAgents(): Promise<TGAgent[]> { return this.client.request<TGAgent[]>('/agents'); }

  getClient(): ThoughtfulGPTClient { return this.client; }
}
