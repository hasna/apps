// Autom Connector — Workflow automation platform
import { AutomClient } from './client';
import type { AutomConfig, AutomWorkflow, AutomExecution, AutomExecutionList, AutomWebhook } from '../types';
export { AutomClient } from './client';

export class Autom {
  private readonly client: AutomClient;
  constructor(config: AutomConfig) { this.client = new AutomClient(config); }
  static fromEnv(): Autom {
    const apiKey = process.env.AUTOM_API_KEY;
    if (!apiKey) throw new Error('AUTOM_API_KEY is required');
    return new Autom({ apiKey });
  }

  async listWorkflows(): Promise<AutomWorkflow[]> { return this.client.request<AutomWorkflow[]>('/workflows'); }
  async getWorkflow(workflowId: string): Promise<AutomWorkflow> { return this.client.request<AutomWorkflow>(`/workflows/${workflowId}`); }
  async createWorkflow(data: { name: string; description?: string; trigger?: { type: string; config: Record<string, unknown> }; steps?: { type: string; name: string; config: Record<string, unknown> }[] }): Promise<AutomWorkflow> {
    return this.client.request<AutomWorkflow>('/workflows', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateWorkflow(workflowId: string, data: { name?: string; description?: string; status?: 'active' | 'inactive' }): Promise<AutomWorkflow> {
    return this.client.request<AutomWorkflow>(`/workflows/${workflowId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteWorkflow(workflowId: string): Promise<void> { await this.client.request(`/workflows/${workflowId}`, { method: 'DELETE' }); }
  async triggerWorkflow(workflowId: string, data?: Record<string, unknown>): Promise<AutomExecution> {
    return this.client.request<AutomExecution>(`/workflows/${workflowId}/trigger`, { method: 'POST', body: data || {} });
  }

  async listExecutions(workflowId: string, options?: { page?: number; limit?: number }): Promise<AutomExecutionList> {
    return this.client.request<AutomExecutionList>(`/workflows/${workflowId}/executions`, { params: { page: options?.page, limit: options?.limit } });
  }
  async getExecution(executionId: string): Promise<AutomExecution> { return this.client.request<AutomExecution>(`/executions/${executionId}`); }
  async cancelExecution(executionId: string): Promise<void> { await this.client.request(`/executions/${executionId}/cancel`, { method: 'POST' }); }

  async listWebhooks(): Promise<AutomWebhook[]> { return this.client.request<AutomWebhook[]>('/webhooks'); }
  async createWebhook(data: { url: string; events: string[]; workflow_id?: string }): Promise<AutomWebhook> {
    return this.client.request<AutomWebhook>('/webhooks', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteWebhook(webhookId: string): Promise<void> { await this.client.request(`/webhooks/${webhookId}`, { method: 'DELETE' }); }

  getClient(): AutomClient { return this.client; }
}
