export interface TheCustomerFactorConfig { apiKey: string; }

export interface TCFCustomer { id: number; first_name: string; last_name: string; company: string; email: string; phone: string; address: string; city: string; state: string; zip: string; notes: string; created_at: string; }
export interface TCFJob { id: number; customer_id: number; description: string; status: string; scheduled_date: string; completed_date: string | null; amount: number; crew: string; notes: string; }
export interface TCFInvoice { id: number; customer_id: number; job_id: number | null; amount: number; balance: number; status: string; date: string; due_date: string; }
export interface TCFEstimate { id: number; customer_id: number; description: string; amount: number; status: string; date: string; }

export class TheCustomerFactorApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TheCustomerFactorApiError'; this.statusCode = statusCode; }
}
