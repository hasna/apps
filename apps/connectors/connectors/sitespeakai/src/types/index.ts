export interface SiteSpeakAIConfig { apiKey: string; }

export interface SSChatbot { id: string; name: string; description: string; model: string; status: string; website_url: string; created_at: string; }
export interface SSConversation { id: string; chatbot_id: string; visitor_id: string; messages: SSMessage[]; rating: number | null; created_at: string; }
export interface SSMessage { role: 'user' | 'assistant'; content: string; timestamp: string; sources?: { title: string; url: string }[]; }
export interface SSDataSource { id: string; chatbot_id: string; type: string; name: string; url: string | null; status: string; }
export interface SSAnalytics { total_conversations: number; total_messages: number; avg_rating: number; top_questions: { question: string; count: number }[]; }

export class SiteSpeakAIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SiteSpeakAIApiError'; this.statusCode = statusCode; }
}
