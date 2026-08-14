export interface SyncroMSPConfig { subdomain: string; apiKey: string; }

export interface SMTicket { id: number; subject: string; body: string; status: string; priority: string; customer_id: number; contact_id: number | null; due_date: string | null; created_at: string; updated_at: string; }
export interface SMTicketList { tickets: SMTicket[]; meta: { total_entries: number; total_pages: number; current_page: number }; }
export interface SMCustomer { id: number; firstname: string; lastname: string; email: string; phone: string; business_name: string; address: string; city: string; state: string; zip: string; }
export interface SMAsset { id: number; name: string; asset_type: string; serial_number: string; customer_id: number; status: string; }
export interface SMInvoice { id: number; customer_id: number; number: string; total: number; balance_due: number; status: string; date: string; due_date: string; }

export class SyncroMSPApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SyncroMSPApiError'; this.statusCode = statusCode; }
}
