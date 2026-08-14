export interface MyAskAIConfig { apiKey: string; }

export interface MAAssistant { id: string; name: string; description: string; model: string; status: string; created_at: string; }
export interface MAConversation { id: string; assistant_id: string; messages: MAMessage[]; created_at: string; }
export interface MAMessage { role: 'user' | 'assistant'; content: string; sources?: { title: string; url: string; snippet: string }[]; }
export interface MADataSource { id: string; assistant_id: string; type: string; name: string; status: string; created_at: string; }

export class MyAskAIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MyAskAIApiError'; this.statusCode = statusCode; }
}
