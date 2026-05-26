export interface RelevanceAIConfig { apiKey: string; region?: string; projectId: string; }

export interface RAAgent { agent_id: string; name: string; description: string; system_prompt: string; model: string; tools: string[]; status: string; created_at: string; }
export interface RAConversation { conversation_id: string; agent_id: string; messages: RAMessage[]; created_at: string; }
export interface RAMessage { role: 'user' | 'agent'; content: string; timestamp: string; tool_calls?: { name: string; input: Record<string, unknown>; output: unknown }[]; }
export interface RATool { tool_id: string; name: string; description: string; type: string; params: Record<string, unknown>; }
export interface RAKnowledgeSet { knowledge_set_id: string; name: string; description: string; documents_count: number; }

export class RelevanceAIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'RelevanceAIApiError'; this.statusCode = statusCode; }
}
