export interface EngatiConfig { apiKey: string; botKey: string; }

export interface ENBot { bot_key: string; name: string; description: string; status: string; channels: string[]; created_at: string; }
export interface ENConversation { id: string; customer_id: string; channel: string; status: string; messages: ENMessage[]; created_at: string; }
export interface ENMessage { id: string; type: 'user' | 'bot'; text: string; timestamp: string; }
export interface ENCustomer { id: string; name: string; email: string; phone: string; channel: string; tags: string[]; custom_attributes: Record<string, unknown>; }
export interface ENCustomerList { customers: ENCustomer[]; total: number; page: number; }
export interface ENBroadcast { id: string; name: string; status: string; sent_count: number; delivered_count: number; created_at: string; }

export class EngatiApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'EngatiApiError'; this.statusCode = statusCode; }
}
