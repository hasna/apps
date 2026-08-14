export interface GPTeaConfig { apiKey: string; }

export interface GTCompletion { id: string; text: string; model: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; }
export interface GTConversation { id: string; messages: GTMessage[]; model: string; created_at: string; }
export interface GTMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export class GPTeaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'GPTeaApiError'; this.statusCode = statusCode; }
}
