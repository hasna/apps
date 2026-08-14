export interface ChatlingConfig { apiKey: string; }

export interface CLChatbot { id: string; name: string; description: string; model: string; initial_message: string; status: string; created_at: string; updated_at: string; }
export interface CLConversation { id: string; chatbot_id: string; messages: CLMessage[]; visitor_id: string; created_at: string; }
export interface CLMessage { id: string; role: 'user' | 'assistant'; content: string; created_at: string; }
export interface CLDataSource { id: string; chatbot_id: string; type: 'url' | 'text' | 'file' | 'qa'; name: string; status: string; created_at: string; }
export interface CLLead { id: string; chatbot_id: string; name: string; email: string; phone: string; metadata: Record<string, unknown>; created_at: string; }

export class ChatlingApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ChatlingApiError'; this.statusCode = statusCode; }
}
