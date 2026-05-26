export interface SmailyConfig { subdomain: string; username: string; password: string; }

export interface SMCampaign { id: number; name: string; subject: string; status: string; sent: number; opened: number; clicked: number; created_at: string; }
export interface SMSubscriber { email: string; name: string; is_unsubscribed: boolean; fields: Record<string, string>; created_at: string; }
export interface SMSubscriberList { subscribers: SMSubscriber[]; total: number; }
export interface SMAutoresponder { id: number; name: string; status: string; trigger: string; }
export interface SMSegment { id: number; name: string; subscribers_count: number; }

export class SmailyApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SmailyApiError'; this.statusCode = statusCode; }
}
