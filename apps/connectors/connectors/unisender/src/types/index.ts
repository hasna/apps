export interface UniSenderConfig { apiKey: string; }

export interface USList { id: number; title: string; before_subscribe_url: string; after_subscribe_url: string; }
export interface USContact { email: string; phone?: string; tags?: string; fields?: Record<string, string>; }
export interface USCampaign { id: number; start_time: string; status: string; subject: string; sender_name: string; sender_email: string; list_id: number; }
export interface USCampaignStats { total: number; sent: number; delivered: number; opened: number; clicked: number; unsubscribed: number; spam: number; }
export interface USMessage { id: number; sub_user_id: number; list_id: number; subject: string; body: string; sender_name: string; sender_email: string; }
export interface USField { id: number; name: string; type: string; is_visible: boolean; view_pos: number; }

export class UniSenderApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  constructor(message: string, statusCode: number, code?: string) { super(message); this.name = 'UniSenderApiError'; this.statusCode = statusCode; this.code = code; }
}
