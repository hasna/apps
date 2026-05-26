export interface ClickSendConfig { username: string; apiKey: string; }

export interface CSSmsMessage { to: string; body: string; from?: string; source?: string; custom_string?: string; }
export interface CSSmsResult { direction: string; date: number; to: string; body: string; from: string; status: string; message_id: string; message_price: string; }
export interface CSSmsHistory { data: CSSmsResult[]; total: number; per_page: number; current_page: number; }
export interface CSContact { contact_id: number; phone_number: string; first_name: string; last_name: string; email: string; custom_1: string; custom_2: string; }
export interface CSContactList { list_id: number; list_name: string; contact_count: number; }
export interface CSAccount { username: string; user_email: string; user_phone: string; balance: string; country: string; }

export class ClickSendApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ClickSendApiError'; this.statusCode = statusCode; }
}
