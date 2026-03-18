// Relevance AI Connector — AI platform for agents and workflows
import { RelevanceAIClient } from './client';
import type { RelevanceAIConfig, RAAgent, RAConversation, RATool, RAKnowledgeSet } from '../types';
export { RelevanceAIClient } from './client';

export class RelevanceAI {
  private readonly client: RelevanceAIClient;
  constructor(config: RelevanceAIConfig) { this.client = new RelevanceAIClient(config); }
  static fromEnv(): RelevanceAI {
    const apiKey = process.env.RELEVANCEAI_API_KEY;
    const projectId = process.env.RELEVANCEAI_PROJECT_ID;
    if (!apiKey || !projectId) throw new Error('RELEVANCEAI_API_KEY and RELEVANCEAI_PROJECT_ID are required');
    return new RelevanceAI({ apiKey, projectId, region: process.env.RELEVANCEAI_REGION });
  }

  async listAgents(): Promise<RAAgent[]> { return this.client.request<RAAgent[]>('/agents/list', { method: 'POST', body: {} }); }
  async getAgent(agentId: string): Promise<RAAgent> { return this.client.request<RAAgent>(`/agents/${agentId}`); }

  async triggerAgent(agentId: string, message: string, conversationId?: string): Promise<{ conversation_id: string; answer: string }> {
    return this.client.request(`/agents/trigger`, { method: 'POST', body: { agent_id: agentId, message: { role: 'user', content: message }, conversation_id: conversationId } as Record<string, unknown> });
  }

  async listConversations(agentId: string): Promise<RAConversation[]> {
    return this.client.request<RAConversation[]>('/agents/conversations/list', { method: 'POST', body: { agent_id: agentId } });
  }

  async listTools(): Promise<RATool[]> { return this.client.request<RATool[]>('/tools/list', { method: 'POST', body: {} }); }
  async runTool(toolId: string, params: Record<string, unknown>): Promise<{ output: unknown }> {
    return this.client.request('/tools/trigger', { method: 'POST', body: { tool_id: toolId, params } });
  }

  async listKnowledgeSets(): Promise<RAKnowledgeSet[]> { return this.client.request<RAKnowledgeSet[]>('/knowledge/list', { method: 'POST', body: {} }); }
  async searchKnowledge(knowledgeSetId: string, query: string): Promise<{ results: { text: string; score: number }[] }> {
    return this.client.request('/knowledge/search', { method: 'POST', body: { knowledge_set_id: knowledgeSetId, query } });
  }

  getClient(): RelevanceAIClient { return this.client; }
}
