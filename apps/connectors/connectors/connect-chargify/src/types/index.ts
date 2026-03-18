// Chargify uses subdomain-based URLs like Auth0
export interface ChargifyConfig { apiKey: string; subdomain: string; baseUrl?: string; }

export interface CFSubscription { id: number; state: string; customer: { id: number; email: string; first_name: string; last_name: string }; product: { id: number; name: string; price_in_cents: number }; current_period_ends_at: string | null; created_at: string; }
export interface CFCustomer { id: number; first_name: string; last_name: string; email: string; phone: string | null; organization: string | null; reference: string | null; created_at: string; }
export interface CFProduct { id: number; name: string; handle: string; price_in_cents: number; interval: number; interval_unit: 'month' | 'day'; trial_price_in_cents: number | null; trial_interval: number | null; }
export interface CFInvoice { uid: string; number: string; sequence_number: number; transaction_time: string; created_at: string; due_amount: string; paid_amount: string; status: string; customer: { id: number; email: string }; }

export class ChargifyApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ChargifyApiError'; this.statusCode = statusCode; }
}
