export interface LapostaConfig { apiKey: string; }

export interface LPList { list_id: string; name: string; remarks: string; subscribe_notification_email: string; unsubscribe_notification_email: string; members: { active: number; unsubscribed: number; cleaned: number }; created: string; modified: string; }
export interface LPMember { member_id: string; list_id: string; email: string; state: string; signup_date: string; modified: string; ip: string; custom_fields: Record<string, string>; }
export interface LPMemberList { data: { member: LPMember }[]; }
export interface LPCampaign { campaign_id: string; list_id: string; subject: string; from_name: string; from_email: string; reply_to: string; status: string; created: string; modified: string; delivered: number; opened: number; clicked: number; }
export interface LPWebhook { webhook_id: string; list_id: string; event: string; url: string; blocked: boolean; }

export class LapostaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'LapostaApiError'; this.statusCode = statusCode; }
}
