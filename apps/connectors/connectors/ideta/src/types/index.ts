export interface IdetaConfig { apiKey: string; }

export interface IDBot { id: string; name: string; description: string; status: string; language: string; channels: string[]; created_at: string; }
export interface IDConversation { id: string; bot_id: string; user_id: string; channel: string; messages: IDMessage[]; created_at: string; }
export interface IDMessage { id: string; type: 'user' | 'bot'; text: string; timestamp: string; }
export interface IDUser { id: string; name: string; email: string; channel: string; tags: string[]; custom_data: Record<string, unknown>; }
export interface IDIntent { id: string; name: string; examples: string[]; responses: string[]; }

export class IdetaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'IdetaApiError'; this.statusCode = statusCode; }
}
