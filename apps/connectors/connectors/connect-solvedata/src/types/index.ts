export interface SolveDataConfig { apiKey: string; }

export interface SDCustomer { id: string; email: string; first_name: string; last_name: string; total_orders: number; total_spent: number; tags: string[]; segments: string[]; first_seen: string; last_seen: string; }
export interface SDCustomerList { customers: SDCustomer[]; total: number; page: number; per_page: number; }
export interface SDSegment { id: string; name: string; description: string; customer_count: number; created_at: string; }
export interface SDEvent { id: string; customer_id: string; event_type: string; properties: Record<string, unknown>; timestamp: string; }

export class SolveDataApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SolveDataApiError'; this.statusCode = statusCode; }
}
