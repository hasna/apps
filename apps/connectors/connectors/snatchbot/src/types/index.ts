export interface SnatchBotConfig { token: string; }

export interface SBBot { id: string; name: string; description: string; channels: string[]; status: string; created_at: string; }
export interface SBConversation { id: string; bot_id: string; user_id: string; channel: string; messages: SBMessage[]; created_at: string; }
export interface SBMessage { id: string; type: 'user' | 'bot'; text: string; channel: string; timestamp: string; }
export interface SBUser { id: string; name: string; email: string; channel: string; last_interaction: string; tags: string[]; }
export interface SBBroadcast { id: string; name: string; status: string; sent_count: number; created_at: string; }

export class SnatchBotApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SnatchBotApiError'; this.statusCode = statusCode; }
}
