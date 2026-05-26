export interface MailerLiteConfig { apiKey: string; }

export interface MLSubscriber { id: string; email: string; status: string; fields: Record<string, string>; groups: { id: string; name: string }[]; subscribed_at: string; created_at: string; updated_at: string; }
export interface MLSubscriberList { data: MLSubscriber[]; meta: { current_page: number; last_page: number; per_page: number; total: number }; }
export interface MLGroup { id: string; name: string; active_count: number; sent_count: number; opens_count: number; created_at: string; }
export interface MLCampaign { id: string; name: string; type: string; status: string; emails: { id: string; subject: string; from: string; from_name: string }[]; stats: { sent: number; opens_count: number; clicks_count: number; unsubscribes_count: number }; created_at: string; }
export interface MLAutomation { id: string; name: string; status: string; steps_count: number; subscribers_count: number; created_at: string; }
export interface MLForm { id: string; name: string; type: string; subscribers_count: number; created_at: string; }

export class MailerLiteApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MailerLiteApiError'; this.statusCode = statusCode; }
}
