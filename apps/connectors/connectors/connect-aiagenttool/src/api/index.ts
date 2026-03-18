// AI Agent Tool Connector — AI agent tooling and orchestration
import { AIAgentToolClient } from './client';
import type { AIAgentToolConfig, AATAgent, AATTool, AATExecution, AATExecutionList } from '../types';
export { AIAgentToolClient } from './client';

export class AIAgentTool {
  private readonly client: AIAgentToolClient;
  constructor(config: AIAgentToolConfig) { this.client = new AIAgentToolClient(config); }
  static fromEnv(): AIAgentTool {
    const apiKey = process.env.AIAGENTTOOL_API_KEY;
    if (!apiKey) throw new Error('AIAGENTTOOL_API_KEY is required');
    return new AIAgentTool({ apiKey });
  }

  async listAgents(): Promise<AATAgent[]> { return this.client.request<AATAgent[]>('/agents'); }
  async getAgent(agentId: string): Promise<AATAgent> { return this.client.request<AATAgent>(`/agents/${agentId}`); }
  async createAgent(data: { name: string; description?: string; model?: string; tools?: string[]; instructions?: string }): Promise<AATAgent> {
    return this.client.request<AATAgent>('/agents', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateAgent(agentId: string, data: { name?: string; description?: string; model?: string; tools?: string[]; instructions?: string }): Promise<AATAgent> {
    return this.client.request<AATAgent>(`/agents/${agentId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteAgent(agentId: string): Promise<void> { await this.client.request(`/agents/${agentId}`, { method: 'DELETE' }); }

  async executeAgent(agentId: string, input: string): Promise<AATExecution> {
    return this.client.request<AATExecution>(`/agents/${agentId}/execute`, { method: 'POST', body: { input } });
  }
  async getExecution(executionId: string): Promise<AATExecution> { return this.client.request<AATExecution>(`/executions/${executionId}`); }
  async listExecutions(agentId: string, options?: { page?: number; limit?: number }): Promise<AATExecutionList> {
    return this.client.request<AATExecutionList>(`/agents/${agentId}/executions`, { params: { page: options?.page, limit: options?.limit } });
  }

  async listTools(): Promise<AATTool[]> { return this.client.request<AATTool[]>('/tools'); }
  async getTool(toolId: string): Promise<AATTool> { return this.client.request<AATTool>(`/tools/${toolId}`); }
  async createTool(data: { name: string; description: string; type: string; parameters: Record<string, unknown> }): Promise<AATTool> {
    return this.client.request<AATTool>('/tools', { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): AIAgentToolClient { return this.client; }
}
