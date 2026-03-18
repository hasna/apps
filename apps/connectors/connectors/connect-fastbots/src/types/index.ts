export interface FastbotsConfig { apiKey: string; }

export interface FBBot { id: string; name: string; description: string; model: string; temperature: number; system_prompt: string; status: string; created_at: string; updated_at: string; }
export interface FBConversation { id: string; bot_id: string; visitor_id: string; messages: FBMessage[]; created_at: string; }
export interface FBMessage { role: 'user' | 'assistant'; content: string; created_at: string; }
export interface FBDataSource { id: string; bot_id: string; type: 'url' | 'text' | 'file'; name: string; status: string; created_at: string; }
export interface FBLead { id: string; bot_id: string; name: string; email: string; phone: string; metadata: Record<string, unknown>; created_at: string; }

export class FastbotsApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FastbotsApiError'; this.statusCode = statusCode; }
}
