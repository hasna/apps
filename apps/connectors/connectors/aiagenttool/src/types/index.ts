export interface AIAgentToolConfig { apiKey: string; }

export interface AATAgent { id: string; name: string; description: string; model: string; tools: string[]; instructions: string; status: string; created_at: string; updated_at: string; }
export interface AATTool { id: string; name: string; description: string; type: string; parameters: Record<string, unknown>; }
export interface AATExecution { id: string; agent_id: string; status: 'running' | 'completed' | 'failed'; input: string; output: string | null; tool_calls: { tool_id: string; input: Record<string, unknown>; output: unknown }[]; started_at: string; finished_at: string | null; tokens_used: number; }
export interface AATExecutionList { executions: AATExecution[]; total: number; page: number; }

export class AIAgentToolApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AIAgentToolApiError'; this.statusCode = statusCode; }
}
