export interface HandwryttenConfig { apiKey: string; }

export interface HWCard { id: string; name: string; category: string; price: number; preview_url: string; dimensions: { width: number; height: number }; }
export interface HWFont { id: string; name: string; preview_url: string; }
export interface HWOrder { id: string; status: string; card_id: string; message: string; recipient: HWRecipient; sender: HWSender; created_at: string; }
export interface HWRecipient { name: string; address1: string; address2?: string; city: string; state: string; zip: string; country: string; }
export interface HWSender { name: string; address1: string; city: string; state: string; zip: string; country: string; }

export class HandwryttenApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'HandwryttenApiError'; this.statusCode = statusCode; }
}
