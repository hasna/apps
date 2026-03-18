export interface MoonMailConfig { apiKey: string; }

export interface MMCampaign { id: string; name: string; subject: string; body: string; status: string; sent_at: string | null; open_rate: number; click_rate: number; created_at: string; }
export interface MMList { id: string; name: string; subscribers_count: number; created_at: string; }
export interface MMSubscriber { id: string; email: string; status: string; list_id: string; metadata: Record<string, string>; created_at: string; }
export interface MMSender { id: string; email: string; name: string; verified: boolean; }

export class MoonMailApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MoonMailApiError'; this.statusCode = statusCode; }
}
