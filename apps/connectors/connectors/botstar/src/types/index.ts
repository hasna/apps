export interface BotStarConfig { token: string; }

export interface BSBot { id: string; name: string; description: string; status: string; platform: string; created_at: string; updated_at: string; }
export interface BSFlow { id: string; bot_id: string; name: string; type: string; is_default: boolean; }
export interface BSSubscriber { id: string; bot_id: string; name: string; email: string; phone: string; platform: string; first_interaction: string; last_interaction: string; tags: string[]; custom_fields: Record<string, unknown>; }
export interface BSSubscriberList { subscribers: BSSubscriber[]; total: number; page: number; per_page: number; }
export interface BSBroadcast { id: string; bot_id: string; name: string; status: string; sent_count: number; delivered_count: number; opened_count: number; created_at: string; }
export interface BSConversation { id: string; subscriber_id: string; messages: { role: string; content: string; timestamp: string }[]; }

export class BotStarApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BotStarApiError'; this.statusCode = statusCode; }
}
