export interface SellixConfig { apiKey: string; }

export interface SXProduct { uniqid: string; title: string; description: string; price: number; currency: string; type: string; stock: number; image_attachment: string | null; created_at: number; updated_at: number; }
export interface SXOrder { uniqid: string; product_id: string; email: string; quantity: number; total: number; currency: string; status: string; gateway: string; created_at: number; }
export interface SXOrderList { orders: SXOrder[]; }
export interface SXCoupon { uniqid: string; code: string; discount: number; discount_type: 'PERCENTAGE' | 'FIXED'; max_uses: number; uses: number; created_at: number; }
export interface SXCategory { uniqid: string; title: string; products_count: number; }
export interface SXCustomer { id: string; email: string; total_spent: number; orders_count: number; created_at: number; }
export interface SXFeedback { uniqid: string; product_id: string; score: number; message: string; reply: string | null; created_at: number; }

export class SellixApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SellixApiError'; this.statusCode = statusCode; }
}
