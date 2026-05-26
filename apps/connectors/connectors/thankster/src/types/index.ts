export interface ThanksterConfig { apiKey: string; }

export interface TSCard { id: string; template_id: string; status: string; recipient: TSRecipient; sender: TSSender; message: string; created_at: string; sent_at: string | null; delivery_estimate: string | null; }
export interface TSRecipient { name: string; address1: string; address2?: string; city: string; state: string; zip: string; country: string; }
export interface TSSender { name: string; address1: string; city: string; state: string; zip: string; country: string; }
export interface TSTemplate { id: string; name: string; description: string; preview_url: string; category: string; }
export interface TSOrder { id: string; cards: string[]; total: number; currency: string; status: string; created_at: string; }

export class ThanksterApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ThanksterApiError'; this.statusCode = statusCode; }
}
