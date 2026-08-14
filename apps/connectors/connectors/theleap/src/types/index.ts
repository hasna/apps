export interface TheLeapConfig { apiKey: string; }

export interface TLProduct { id: string; title: string; description: string; price: number; currency: string; type: string; status: string; url: string; created_at: string; }
export interface TLOrder { id: string; product_id: string; customer_email: string; customer_name: string; amount: number; currency: string; status: string; created_at: string; }
export interface TLCustomer { id: string; email: string; name: string; total_spent: number; orders_count: number; created_at: string; }

export class TheLeapApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TheLeapApiError'; this.statusCode = statusCode; }
}
