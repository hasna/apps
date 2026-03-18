export interface SwagUpConfig { apiKey: string; }

export interface SUProduct { id: number; name: string; description: string; price: number; category: string; images: { url: string }[]; sizes: string[]; colors: string[]; min_quantity: number; }
export interface SUOrder { id: number; status: string; total: number; currency: string; items: { product_id: number; quantity: number; size: string; color: string }[]; shipping_address: SUAddress; created_at: string; }
export interface SUAddress { name: string; company: string; address1: string; address2: string; city: string; state: string; zip: string; country: string; phone: string; }
export interface SUPack { id: number; name: string; description: string; products: { product_id: number; quantity: number }[]; price: number; }
export interface SURecipient { id: number; name: string; email: string; address: SUAddress; status: string; }

export class SwagUpApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SwagUpApiError'; this.statusCode = statusCode; }
}
