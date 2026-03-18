export interface ChatlingConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface Chatbot {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'inactive' | 'training';
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  chatbot_id: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface SendMessageResult {
  conversation_id: string;
  message: ChatMessage;
  response: ChatMessage;
}

export class ChatlingApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ChatlingApiError';
    this.statusCode = statusCode;
  }
}
